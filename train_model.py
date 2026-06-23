import os
import json
import pandas as pd
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.preprocessing import LabelEncoder


# Ensure target directories exist
os.makedirs('web/data/exact_violations', exist_ok=True)

print("Step 1: Ingesting dataset for model training...")
df = pd.read_csv('jan to may police violation_anonymized791b166.csv')
print(f"Loaded {len(df):,} records successfully.")

print("Step 2: Processing timestamps and computing PCII...")
# Parse datetime with mixed formats
df['created_datetime'] = pd.to_datetime(df['created_datetime'], format='mixed')
df['ist_time'] = df['created_datetime'].dt.tz_convert('Asia/Kolkata')
df['hour'] = df['ist_time'].dt.hour
df['day_of_week'] = df['ist_time'].dt.day_name()
df['date_only'] = df['ist_time'].dt.date
df['month_num'] = df['ist_time'].dt.month

# Recompute PCII consistently
VEHICLE_WEIGHTS = {
    'SCOOTER': 1.0, 'MOTOR CYCLE': 1.0, 'MOPED': 1.0,
    'PASSENGER AUTO': 2.0, 'GOODS AUTO': 2.0,
    'CAR': 4.0, 'JEEP': 4.0, 'OTHERS': 3.0,
    'VAN': 5.0, 'TEMPO': 5.0, 'MINI LORRY': 5.0,
    'MAXI-CAB': 6.0, 'LGV': 6.0, 'TRACTOR': 6.0,
    'PRIVATE BUS': 10.0, 'BUS (BMTC/KSRTC)': 10.0, 'HGV': 10.0,
    'LORRY/GOODS VEHICLE': 10.0, 'TOURIST BUS': 10.0, 'SCHOOL VEHICLE': 10.0,
    'TANKER': 10.0, 'FACTORY BUS': 10.0
}
DEFAULT_VEHICLE_WEIGHT = 3.0

VIOLATION_WEIGHTS = {
    'DOUBLE PARKING': 3.5, 'PARKING IN A MAIN ROAD': 3.0,
    'PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC': 2.5,
    'WRONG PARKING': 1.5, 'NO PARKING': 1.5, 'PARKING ON FOOTPATH': 1.0,
}
DEFAULT_VIOLATION_WEIGHT = 1.5

def get_vehicle_weight(vehicle):
    if not isinstance(vehicle, str):
        return DEFAULT_VEHICLE_WEIGHT
    return VEHICLE_WEIGHTS.get(vehicle.upper(), DEFAULT_VEHICLE_WEIGHT)

def get_violation_weight(violation_str):
    if not isinstance(violation_str, str):
        return DEFAULT_VIOLATION_WEIGHT
    try:
        violations = json.loads(violation_str)
    except Exception:
        val = violation_str.replace('[', '').replace(']', '').replace('"', '').replace("'", "")
        violations = [v.strip() for v in val.split(',') if v.strip()]
    if not violations:
        return DEFAULT_VIOLATION_WEIGHT
    weights = [VIOLATION_WEIGHTS.get(v.upper(), DEFAULT_VIOLATION_WEIGHT) for v in violations]
    if len(weights) == 1:
        return weights[0]
    weights.sort(reverse=True)
    return weights[0] + 0.3 * sum(weights[1:])

def get_temporal_weight(hour):
    if hour in [8, 9, 10, 11, 17, 18, 19, 20]:
        return 2.5
    elif hour in [12, 13, 16]:
        return 1.5
    elif hour in [7, 14, 15, 21, 22]:
        return 1.0
    return 0.5

def get_validation_weight(status):
    if isinstance(status, str) and status.lower() == 'rejected':
        return 0.1
    return 1.0

df['w_vehicle'] = df['vehicle_type'].apply(get_vehicle_weight)
df['w_violation'] = df['violation_type'].apply(get_violation_weight)
df['w_time'] = df['hour'].apply(get_temporal_weight)
df['w_validation'] = df['validation_status'].apply(get_validation_weight)
df['pcii'] = df['w_vehicle'] * df['w_violation'] * df['w_time'] * df['w_validation']

print("Step 3: Constructing empty grid of all station-date-hour combinations to avoid bias...")
min_date = df['date_only'].min()
max_date = df['date_only'].max()
all_dates = pd.date_range(start=min_date, end=max_date, freq='D')
all_stations = df['police_station'].dropna().unique()

grid = pd.MultiIndex.from_product(
    [all_stations, all_dates, range(24)],
    names=['police_station', 'date', 'hour']
).to_frame().reset_index(drop=True)

grid['date_only'] = grid['date'].dt.date
grid['month_num'] = grid['date'].dt.month
grid['day_of_week_num'] = grid['date'].dt.dayofweek # 0-6

print("Step 4: Aggregating historical violations count and cumulative PCII...")
df_grouped = df.groupby(['police_station', 'date_only', 'hour']).agg(
    violation_count=('id', 'count'),
    total_pcii=('pcii', 'sum')
).reset_index()

# Merge grid with grouped historical records
train_df = pd.merge(grid, df_grouped, on=['police_station', 'date_only', 'hour'], how='left')
train_df['violation_count'] = train_df['violation_count'].fillna(0).astype(int)
train_df['total_pcii'] = train_df['total_pcii'].fillna(0.0)

print(f"Aggregated training set size: {len(train_df):,} rows.")

print("Step 5: Training ML Models using HistGradientBoostingRegressor...")
# Encode categorical station names
station_encoder = LabelEncoder()
train_df['station_code'] = station_encoder.fit_transform(train_df['police_station'])

# Features and Targets
features = ['station_code', 'month_num', 'day_of_week_num', 'hour']
X = train_df[features]
y_count = train_df['violation_count']
y_pcii = train_df['total_pcii']

# Model for violation count prediction
model_count = HistGradientBoostingRegressor(categorical_features=[0, 1, 2, 3], random_state=42)
model_count.fit(X, y_count)

# Model for PCII severity prediction
model_pcii = HistGradientBoostingRegressor(categorical_features=[0, 1, 2, 3], random_state=42)
model_pcii.fit(X, y_pcii)

print("Models trained successfully.")

print("Step 6: Generating predictions for the WHOLE YEAR (all 12 months, 7 days, 24 hours)...")
# Predict for all 54 stations, 12 months, 7 days, 24 hours
stations_list = sorted(list(all_stations))
months = list(range(1, 13))
days = list(range(7)) # 0: Monday, ..., 6: Sunday
hours = list(range(24))

predict_grid = pd.MultiIndex.from_product(
    [stations_list, months, days, hours],
    names=['police_station', 'month_num', 'day_of_week_num', 'hour']
).to_frame().reset_index(drop=True)

predict_grid['station_code'] = station_encoder.transform(predict_grid['police_station'])
X_predict = predict_grid[features]

predict_grid['pred_count'] = np.clip(model_count.predict(X_predict), 0, None)
predict_grid['pred_pcii'] = np.clip(model_pcii.predict(X_predict), 0, None)

# Classify patrol urge level
def get_patrol_urge(count, pcii):
    if pcii >= 15.0 or count >= 10:
        return "CRITICAL"
    elif pcii >= 8.0 or count >= 5:
        return "HIGH"
    elif pcii >= 3.0 or count >= 2:
        return "MEDIUM"
    return "LOW"

predict_grid['patrol_urge'] = predict_grid.apply(lambda r: get_patrol_urge(r['pred_count'], r['pred_pcii']), axis=1)

print("Step 7: Compiling yearly predictions database into JSON...")
# We save in a nested structure: station -> month -> day_of_week -> hour -> [count, pcii, urge]
day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

yearly_predictions = {}
for station, group in predict_grid.groupby('police_station'):
    station_dict = {}
    for month, m_group in group.groupby('month_num'):
        month_dict = {}
        for day_num, d_group in m_group.groupby('day_of_week_num'):
            day_name = day_names[day_num]
            day_dict = {}
            for idx, r in d_group.iterrows():
                h = int(r['hour'])
                day_dict[str(h)] = {
                    "count": round(float(r['pred_count']), 2),
                    "pcii": round(float(r['pred_pcii']), 2),
                    "urge": r['patrol_urge']
                }
            month_dict[day_name] = day_dict
        station_dict[str(month)] = month_dict
    yearly_predictions[station] = station_dict

with open('web/data/yearly_predictions.json', 'w') as f:
    json.dump(yearly_predictions, f)

print(f"Saved yearly predictions to 'web/data/yearly_predictions.json'.")

print("Step 8: Exporting station-specific exact historical violations...")
# Filter columns to keep file size small
df_sorted = df.sort_values('created_datetime', ascending=False)

for station, station_df in df_sorted.groupby('police_station'):
    grouped_violations = {}
    for day_name in day_names:
        grouped_violations[day_name] = {str(h): [] for h in range(24)}
        
    for _, row in station_df.iterrows():
        # Parse violation list
        violation_str = row['violation_type']
        try:
            violations_list = json.loads(violation_str)
        except Exception:
            val = str(violation_str).replace('[', '').replace(']', '').replace('"', '').replace("'", "")
            violations_list = [v.strip() for v in val.split(',') if v.strip()]
            
        time_str = row['ist_time'].strftime('%Y-%m-%d %H:%M:%S')
        day_of_week = row['day_of_week']
        h = str(row['hour'])
        
        record = {
            "time": time_str,
            "vehicle": str(row['vehicle_type']),
            "violations": violations_list,
            "status": str(row['validation_status']) if pd.notna(row['validation_status']) else "Pending",
            "junction": str(row['junction_name']) if pd.notna(row['junction_name']) else "No Junction",
            "lat": float(row['latitude']),
            "lng": float(row['longitude'])
        }
        
        if day_of_week in grouped_violations and h in grouped_violations[day_of_week]:
            # Limit count per hour slot to 200 to avoid huge JSON file sizes
            if len(grouped_violations[day_of_week][h]) < 200:
                grouped_violations[day_of_week][h].append(record)
                
    station_filename = f"web/data/exact_violations/{station}.json"
    with open(station_filename, 'w') as f:
        json.dump(grouped_violations, f)

print("Station-specific exact violations exported to 'web/data/exact_violations/'.")
print("ML Model Pipeline execution completed successfully!")
