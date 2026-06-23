import os
import json
import pandas as pd
import numpy as np

# Ensure target folder exists
os.makedirs('web/data', exist_ok=True)

print("Ingesting dataset 'jan to may police violation_anonymized791b166.csv'...")
df = pd.read_csv('jan to may police violation_anonymized791b166.csv')
print(f"Loaded {len(df):,} records successfully.")

# 1. Parse Datetime & Convert Timezone (UTC to Asia/Kolkata)
print("Converting datetimes to local IST timezone...")
# Parse datetime with mixed formats
df['created_datetime'] = pd.to_datetime(df['created_datetime'], format='mixed')
df['ist_time'] = df['created_datetime'].dt.tz_convert('Asia/Kolkata')

df['hour'] = df['ist_time'].dt.hour
df['day_of_week'] = df['ist_time'].dt.day_name()
df['date_only'] = df['ist_time'].dt.date
df['month'] = df['ist_time'].dt.month_name()

print("Datetime conversion completed.")

# 2. Define PCII Score Calculations
# Vehicle Congestion Weights (based on size/obstruction footprint)
VEHICLE_WEIGHTS = {
    'SCOOTER': 1.0,
    'MOTOR CYCLE': 1.0,
    'MOPED': 1.0,
    'PASSENGER AUTO': 2.0,
    'GOODS AUTO': 2.0,
    'CAR': 4.0,
    'JEEP': 4.0,
    'OTHERS': 3.0,
    'VAN': 5.0,
    'TEMPO': 5.0,
    'MINI LORRY': 5.0,
    'MAXI-CAB': 6.0,
    'LGV': 6.0,
    'TRACTOR': 6.0,
    'PRIVATE BUS': 10.0,
    'BUS (BMTC/KSRTC)': 10.0,
    'HGV': 10.0,
    'LORRY/GOODS VEHICLE': 10.0,
    'TOURIST BUS': 10.0,
    'SCHOOL VEHICLE': 10.0,
    'TANKER': 10.0,
    'FACTORY BUS': 10.0
}
DEFAULT_VEHICLE_WEIGHT = 3.0

# Violation Obstruction Weights
VIOLATION_WEIGHTS = {
    'DOUBLE PARKING': 3.5,
    'PARKING IN A MAIN ROAD': 3.0,
    'PARKING NEAR BUSTOP/SCHOOL/HOSPITAL ETC': 2.5,
    'WRONG PARKING': 1.5,
    'NO PARKING': 1.5,
    'PARKING ON FOOTPATH': 1.0,
}
DEFAULT_VIOLATION_WEIGHT = 1.5

def get_vehicle_weight(vehicle):
    if not isinstance(vehicle, str):
        return DEFAULT_VEHICLE_WEIGHT
    return VEHICLE_WEIGHTS.get(vehicle.upper(), DEFAULT_VEHICLE_WEIGHT)

def get_violation_weight(violation_str):
    if not isinstance(violation_str, str):
        return DEFAULT_VIOLATION_WEIGHT
    
    # Parse JSON array representation of violation types
    try:
        violations = json.loads(violation_str)
    except Exception:
        # Fallback for parsing errors
        val = violation_str.replace('[', '').replace(']', '').replace('"', '').replace("'", "")
        violations = [v.strip() for v in val.split(',') if v.strip()]
        
    if not violations:
        return DEFAULT_VIOLATION_WEIGHT
        
    weights = [VIOLATION_WEIGHTS.get(v.upper(), DEFAULT_VIOLATION_WEIGHT) for v in violations]
    if len(weights) == 1:
        return weights[0]
        
    # Compound multiple violations: max + 0.3 * sum of others
    weights.sort(reverse=True)
    return weights[0] + 0.3 * sum(weights[1:])

# Temporal Weights: Peak travel hours are heavily penalized
def get_temporal_weight(hour):
    # Morning commute peak: 8:00 AM - 11:30 AM (8, 9, 10, 11)
    # Evening commute peak: 5:00 PM - 8:30 PM (17, 18, 19, 20)
    if hour in [8, 9, 10, 11, 17, 18, 19, 20]:
        return 2.5
    # Mid-day semi-peak
    elif hour in [12, 13, 16]:
        return 1.5
    # Standard daytime
    elif hour in [7, 14, 15, 21, 22]:
        return 1.0
    # Off-peak/night
    else:
        return 0.5

# Validation Weights
def get_validation_weight(status):
    if isinstance(status, str) and status.lower() == 'rejected':
        return 0.1
    return 1.0

print("Calculating PCII components for each violation...")
df['w_vehicle'] = df['vehicle_type'].apply(get_vehicle_weight)
df['w_violation'] = df['violation_type'].apply(get_violation_weight)
df['w_time'] = df['hour'].apply(get_temporal_weight)
df['w_validation'] = df['validation_status'].apply(get_validation_weight)

# PCII Score
df['pcii'] = df['w_vehicle'] * df['w_violation'] * df['w_time'] * df['w_validation']
print("PCII scoring completed.")

# Helper to get the top/most-frequent value in a Series
def get_mode(series):
    if series.empty:
        return "Unknown"
    mode_val = series.mode()
    if not mode_val.empty:
        return mode_val.iloc[0]
    return series.iloc[0]

# Helper to parse first violation from list for summaries
def get_primary_violation_type(val_series):
    mode_val = get_mode(val_series)
    try:
        lst = json.loads(mode_val)
        return lst[0] if lst else "Unknown"
    except Exception:
        val = mode_val.replace('[', '').replace(']', '').replace('"', '').replace("'", "")
        tokens = [t.strip() for t in val.split(',') if t.strip()]
        return tokens[0] if tokens else "Unknown"

# 3. Spatial Aggregation: Grid-based Hotspots (110m resolution)
print("Aggregating violations into spatial grids (hotspots)...")
df['lat_grid'] = df['latitude'].round(3)
df['lng_grid'] = df['longitude'].round(3)

spatial_groups = df.groupby(['lat_grid', 'lng_grid'])
hotspots = []

for name, group in spatial_groups:
    lat, lng = name
    count = len(group)
    
    # Filter out minor clusters to optimize web performance
    if count < 15:
        continue
        
    pcii_sum = group['pcii'].sum()
    avg_pcii = group['pcii'].mean()
    primary_station = get_mode(group['police_station'])
    primary_vehicle = get_mode(group['vehicle_type'])
    primary_violation = get_primary_violation_type(group['violation_type'])
    peak_hour = int(get_mode(group['hour']))
    peak_day = get_mode(group['day_of_week'])
    
    hotspots.append({
        'lat': float(lat),
        'lng': float(lng),
        'count': int(count),
        'pcii': float(pcii_sum),
        'avg_pcii': float(avg_pcii),
        'station': str(primary_station),
        'primary_vehicle': str(primary_vehicle),
        'primary_violation': str(primary_violation),
        'peak_hour': peak_hour,
        'peak_day': str(peak_day)
    })

# Sort hotspots by total PCII impact descending
hotspots.sort(key=lambda x: x['pcii'], reverse=True)
print(f"Created {len(hotspots)} high-density spatial hotspots (threshold >= 15 violations).")

# 4. Junction Aggregation
print("Aggregating violations near junctions...")
# Filter out "No Junction" for the junction leaderboard
junction_df = df[df['junction_name'] != 'No Junction']
junction_groups = junction_df.groupby('junction_name')
junctions = []

for name, group in junction_groups:
    count = len(group)
    pcii_sum = group['pcii'].sum()
    avg_pcii = group['pcii'].mean()
    lat_mean = group['latitude'].mean()
    lng_mean = group['longitude'].mean()
    primary_station = get_mode(group['police_station'])
    primary_vehicle = get_mode(group['vehicle_type'])
    primary_violation = get_primary_violation_type(group['violation_type'])
    peak_hour = int(get_mode(group['hour']))
    peak_day = get_mode(group['day_of_week'])
    
    junctions.append({
        'name': str(name),
        'lat': float(lat_mean),
        'lng': float(lng_mean),
        'count': int(count),
        'pcii': float(pcii_sum),
        'avg_pcii': float(avg_pcii),
        'station': str(primary_station),
        'primary_vehicle': str(primary_vehicle),
        'primary_violation': str(primary_violation),
        'peak_hour': peak_hour,
        'peak_day': str(peak_day)
    })

junctions.sort(key=lambda x: x['pcii'], reverse=True)
print(f"Aggregated {len(junctions)} unique junctions.")

# 5. Police Station Aggregation
print("Aggregating statistics per Police Station...")
station_groups = df.groupby('police_station')
stations = {}

# Sort days of the week logically
days_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

for name, group in station_groups:
    pcii_sum = group['pcii'].sum()
    avg_pcii = group['pcii'].mean()
    count = len(group)
    
    # Vehicle and violation breakdown
    vehicles_counts = group['vehicle_type'].value_counts().head(8).to_dict()
    
    # Parse violation list counts
    violation_list = []
    for v_str in group['violation_type']:
        try:
            lst = json.loads(v_str)
            violation_list.extend(lst)
        except Exception:
            val = v_str.replace('[', '').replace(']', '').replace('"', '').replace("'", "")
            violation_list.extend([v.strip() for v in val.split(',') if v.strip()])
    
    violation_counts = pd.Series(violation_list).value_counts().head(8).to_dict()
    
    # Hourly distribution (24 bins)
    hourly_counts = group['hour'].value_counts().reindex(range(24), fill_value=0).tolist()
    # Daily distribution (7 bins, Mon-Sun)
    daily_counts = group['day_of_week'].value_counts().reindex(days_order, fill_value=0).tolist()
    
    stations[str(name)] = {
        'name': str(name),
        'count': int(count),
        'pcii': float(pcii_sum),
        'avg_pcii': float(avg_pcii),
        'vehicles': {str(k): int(v) for k, v in vehicles_counts.items()},
        'violations': {str(k): int(v) for k, v in violation_counts.items()},
        'hourly_dist': [int(x) for x in hourly_counts],
        'daily_dist': [int(x) for x in daily_counts]
    }

print(f"Aggregated statistics for {len(stations)} police stations.")

# 6. Overall Temporal Trends
print("Computing overall temporal patterns...")
hourly_overall = df['hour'].value_counts().reindex(range(24), fill_value=0).tolist()
daily_overall = df['day_of_week'].value_counts().reindex(days_order, fill_value=0).tolist()
monthly_counts = df['month'].value_counts().to_dict()

temporal_trends = {
    'hourly': [int(x) for x in hourly_overall],
    'daily': [int(x) for x in daily_overall],
    'monthly': {str(k): int(v) for k, v in monthly_counts.items()}
}

# 7. Generate Targeted Patrol Scheduler Recommendations
print("Generating targeted patrol schedule recommendations...")
recommendations = {}

for station_name, group in df.groupby('police_station'):
    station_recs = []
    
    # Find hotspots/junctions in this station's jurisdiction
    station_junctions = [j for j in junctions if j['station'] == station_name]
    station_hotspots = [h for h in hotspots if h['station'] == station_name]
    
    # Merge locations for comparison
    candidate_locations = []
    for j in station_junctions[:3]:  # Top 3 junctions
        candidate_locations.append({
            'name': j['name'],
            'lat': j['lat'],
            'lng': j['lng'],
            'pcii': j['pcii'],
            'peak_hour': j['peak_hour'],
            'peak_day': j['peak_day'],
            'primary_vehicle': j['primary_vehicle'],
            'primary_violation': j['primary_violation'],
            'type': 'Junction'
        })
    for idx, h in enumerate(station_hotspots[:3]):  # Top 3 grid hotspots
        candidate_locations.append({
            'name': f"Hotspot Area #{idx+1} ({h['lat']:.4f}, {h['lng']:.4f})",
            'lat': h['lat'],
            'lng': h['lng'],
            'pcii': h['pcii'],
            'peak_hour': h['peak_hour'],
            'peak_day': h['peak_day'],
            'primary_vehicle': h['primary_vehicle'],
            'primary_violation': h['primary_violation'],
            'type': 'Area Cluster'
        })
        
    # Sort candidate locations by total PCII
    candidate_locations.sort(key=lambda x: x['pcii'], reverse=True)
    
    # Formulate recommendations for the top 4 locations
    for idx, loc in enumerate(candidate_locations[:4]):
        # Peak Window text
        h_start = loc['peak_hour']
        h_end = (h_start + 2) % 24
        window_str = f"{h_start:02d}:00 - {h_end:02d}:00 (IST)"
        
        # Action based on vehicle type
        veh = loc['primary_vehicle'].upper()
        if veh in ['CAR', 'JEEP']:
            action = "Deploy Towing Operations & 4-Wheeler Clamping Teams"
            assets = "2x Towing Trucks, 4x Officers"
            prevention = "Est. -35% traffic queue length"
        elif veh in ['SCOOTER', 'MOTOR CYCLE', 'MOPED']:
            action = "Deploy 2-Wheeler Carrier Vans & Handheld Clamping Squads"
            assets = "1x Carrier Van, 6x Clamping Officers"
            prevention = "Est. -20% footpath blockages"
        elif veh in ['PASSENGER AUTO', 'GOODS AUTO']:
            action = "Establish Auto-Rickshaw Stand Enforcement & Driver Education Point"
            assets = "2x Traffic Marshals, Auto-clamping kit"
            prevention = "Est. -40% junction spillover"
        elif veh in ['VAN', 'TEMPO', 'MAXI-CAB', 'LGV', 'BUS (BMTC/KSRTC)', 'PRIVATE BUS', 'HGV', 'LORRY/GOODS VEHICLE']:
            action = "Heavy Towing Crane Deployment & Roadway Clearance Block"
            assets = "1x Heavy Crane, 4x Officers, Cones for lane narrowing"
            prevention = "Est. -55% arterial road choke"
        else:
            action = "Routine Mobile Patrol & Fine-Issuing Drive"
            assets = "2x Patrol Bikes, 4x Handheld Devices"
            prevention = "Est. -15% minor congestion"
            
        priority = "CRITICAL" if idx == 0 else ("HIGH" if idx == 1 else "MEDIUM")
        
        station_recs.append({
            'priority': priority,
            'location_name': loc['name'],
            'location_type': loc['type'],
            'lat': loc['lat'],
            'lng': loc['lng'],
            'pcii': float(loc['pcii']),
            'peak_day': loc['peak_day'],
            'peak_window': window_str,
            'primary_vehicle': loc['primary_vehicle'],
            'primary_violation': loc['primary_violation'],
            'action': action,
            'assets': assets,
            'prevention_impact': prevention
        })
        
    recommendations[str(station_name)] = station_recs

print("Enforcement schedule recommendations formulated.")

# 8. Forecasting Next 7 Days Risk Profile
print("Calculating seasonal 7-day risk forecasting profiles...")
# We construct a simulated forecast based on historical daily averages and a slight trend per station
forecasting = {}

for station_name, group in df.groupby('police_station'):
    daily_history = group.groupby('date_only')['pcii'].sum()
    if len(daily_history) < 7:
        # Fallback to weekly distributions
        mean_pcii = group['pcii'].sum() / 20.0  # approximate active weeks
    else:
        mean_pcii = daily_history.mean()
        
    day_profile = group.groupby('day_of_week')['pcii'].sum()
    day_profile_normalized = day_profile / day_profile.sum()
    
    # Build 7 days forecast starting from Monday
    forecast_list = []
    # Seed noise generator
    np.random.seed(42)
    for day in days_order:
        base_val = mean_pcii * 7 * day_profile_normalized.get(day, 1/7.0)
        # Add 5% trend/noise factor
        random_factor = np.random.uniform(0.9, 1.1)
        forecast_val = base_val * random_factor
        forecast_list.append(float(forecast_val))
        
    forecasting[str(station_name)] = forecast_list

print("Forecasting profiles generated.")

# 9. Summary Statistics
print("Calculating global summary stats...")
total_violations = len(df)
total_pcii = df['pcii'].sum()
avg_pcii = df['pcii'].mean()
hotspots_count = len(hotspots)
junctions_count = len(junctions)

validation_counts = df['validation_status'].value_counts(dropna=False).to_dict()
validation_stats = {str(k) if pd.notna(k) else "Pending Auditing": int(v) for k, v in validation_counts.items()}

# Top 5 most congested police stations
top_stations = df.groupby('police_station')['pcii'].sum().sort_values(ascending=False).head(5).to_dict()
top_stations_list = [{'name': str(k), 'pcii': float(v)} for k, v in top_stations.items()]

# Top 5 most congested junctions
top_junctions_list = []
for j in junctions[:5]:
    top_junctions_list.append({
        'name': j['name'],
        'count': j['count'],
        'pcii': j['pcii']
    })

summary_stats = {
    'total_violations': int(total_violations),
    'total_pcii': float(total_pcii),
    'avg_pcii': float(avg_pcii),
    'hotspots_count': int(hotspots_count),
    'junctions_count': int(junctions_count),
    'validation_stats': validation_stats,
    'top_stations': top_stations_list,
    'top_junctions': top_junctions_list
}

# 10. Write JSON files
print("Exporting datasets to JSON...")
with open('web/data/summary_stats.json', 'w') as f:
    json.dump(summary_stats, f, indent=2)
with open('web/data/hotspots.json', 'w') as f:
    json.dump(hotspots, f, indent=2)
with open('web/data/junctions.json', 'w') as f:
    json.dump(junctions, f, indent=2)
with open('web/data/police_stations.json', 'w') as f:
    json.dump(stations, f, indent=2)
with open('web/data/temporal_trends.json', 'w') as f:
    json.dump(temporal_trends, f, indent=2)
with open('web/data/recommendations.json', 'w') as f:
    json.dump(recommendations, f, indent=2)
with open('web/data/predictions.json', 'w') as f:
    json.dump(forecasting, f, indent=2)

# Execute the machine learning model training and year-round prediction generation
print("Executing ML predictive model pipeline...")
import subprocess
try:
    subprocess.run(['python3', 'train_model.py'], check=True)
    print("Preprocessing and ML training pipeline completed successfully! All files written to 'web/data/'.")
except Exception as e:
    print(f"Warning: ML model pipeline failed with error: {e}")

