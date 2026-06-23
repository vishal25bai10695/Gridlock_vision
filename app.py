import os
import json
import time
import random
import streamlit as st
import pandas as pd
import folium
from streamlit_folium import folium_static
import plotly.express as px
import plotly.graph_objects as go

# Initialize session state for towing history
if 'towing_history' not in st.session_state:
    st.session_state.towing_history = []

# Set page config
st.set_page_config(
    page_title="BTP Gridlock Vision",
    page_icon="🚨",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom premium CSS styling (Dark Glassmorphism, Terminals, Receipts)
st.markdown("""
<style>
/* CSS styles for terminal and thermal receipt */
.term-box {
    background-color: #05070a;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    padding: 14px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #e1e7f0;
    height: 250px;
    overflow-y: auto;
    margin-bottom: 20px;
}
.term-log-line {
    margin-bottom: 6px;
    line-height: 1.4;
}
.term-prompt {
    color: #00f2fe;
    font-weight: 700;
}
.term-success { color: #10ac84; }
.term-warning { color: #feca57; }
.term-danger { color: #ff6b6b; }
.term-info { color: #54a0ff; }

/* Thermal Challan Receipt */
.challan-receipt {
    background-color: #fcfcfc;
    border: 2px dashed #d1d5db;
    border-radius: 4px;
    padding: 20px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #111827;
    width: 100%;
    max-width: 320px;
    margin: 0 auto;
    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
}
.receipt-header {
    text-align: center;
    border-bottom: 2px dashed #9ca3af;
    padding-bottom: 10px;
    margin-bottom: 12px;
}
.receipt-header h4 {
    margin: 0;
    font-weight: 800;
    font-size: 14px;
    color: #111827;
}
.receipt-header p {
    margin: 2px 0 0;
    font-size: 10px;
    color: #4b5563;
    letter-spacing: 0.5px;
}
.receipt-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
}
.receipt-label {
    font-weight: 700;
    color: #4b5563;
}
.receipt-value {
    color: #111827;
    text-align: right;
}
.receipt-total {
    display: flex;
    justify-content: space-between;
    border-top: 2px dashed #9ca3af;
    padding-top: 8px;
    margin-top: 10px;
    font-weight: 800;
    font-size: 14px;
}
.receipt-barcode {
    text-align: center;
    font-size: 20px;
    margin-top: 15px;
    letter-spacing: 2px;
    color: #111827;
}
</style>
""", unsafe_allow_html=True)

# Helper function to read preprocessed datasets
@st.cache_data
def load_json_data(filename):
    path = os.path.join(os.path.dirname(__file__), 'web', 'data', filename)
    if not os.path.exists(path):
        return None
    with open(path, 'r') as f:
        return json.load(f)

def get_temporal_weight(hour):
    if hour in [8, 9, 10, 11, 17, 18, 19, 20]:
        return 2.5
    elif hour in [12, 13, 16]:
        return 1.5
    elif hour in [7, 14, 15, 21, 22]:
        return 1.0
    return 0.5

# Load data files
hotspots_data = load_json_data('hotspots.json')
junctions_data = load_json_data('junctions.json')
stations_data = load_json_data('police_stations.json')
predictions_data = load_json_data('predictions.json')
recommendations_data = load_json_data('recommendations.json')
summary_stats = load_json_data('summary_stats.json')
yearly_predictions_data = load_json_data('yearly_predictions.json')

# Check if data loaded successfully
if not all([hotspots_data, junctions_data, stations_data, predictions_data, recommendations_data, summary_stats, yearly_predictions_data]):
    st.error("Error: Preprocessed data files not found. Please make sure to run 'python3 preprocess.py' in the root directory first to compile statistics.")
    st.stop()


# Title Panel
st.title("🚨 Gridlock Vision - Operations Dashboard")
st.markdown("Bengaluru Traffic Police (BTP) Congestion Patrol Planning & Automated AI Ingestion")

# Container
tab_ops = st.container()

# Sidebar Filters (Applies to Operations Center)
st.sidebar.header("Enforcement Scope")
station_list = ["All Stations"] + sorted(list(stations_data.keys()))
selected_station = st.sidebar.selectbox("Precinct Jurisdiction", station_list)

st.sidebar.subheader("Temporal Query")

# Determine local IST time
now_ist = pd.Timestamp.now('Asia/Kolkata')
curr_hour = now_ist.hour
curr_day = now_ist.day_name()
curr_month = now_ist.month

months_list = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
selected_month_name = st.sidebar.selectbox("Query Month", months_list, index=curr_month - 1)
curr_month = months_list.index(selected_month_name) + 1

days_list = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
default_day_idx = days_list.index(curr_day) if curr_day in days_list else 0
curr_day = st.sidebar.selectbox("Query Day of Week", days_list, index=default_day_idx)

curr_hour = st.sidebar.slider("Query Hour Slot", 0, 23, curr_hour, format="%02d:00")

# Filter DataFrames
df_hotspots = pd.DataFrame(hotspots_data)
df_junctions = pd.DataFrame(junctions_data)

# 1. Jurisdiction filter
if selected_station != "All Stations":
    df_hotspots = df_hotspots[df_hotspots['station'] == selected_station]
    df_junctions = df_junctions[df_junctions['station'] == selected_station]

# Calculate dynamic ML scale_factor based on predictions
scale_factor = 1.0
if selected_station == "All Stations":
    # Sum predictions across all stations
    total_pred_pcii = 0.0
    for st_name, st_pred in yearly_predictions_data.items():
        month_str = str(curr_month)
        if month_str in st_pred and curr_day in st_pred[month_str] and str(curr_hour) in st_pred[month_str][curr_day]:
            total_pred_pcii += st_pred[month_str][curr_day][str(curr_hour)]["pcii"]
            
    # Sum average PCII across all stations
    total_pcii_sum = sum([st_val.get("pcii", 0) for st_val in stations_data.values()])
    total_avg_pcii = total_pcii_sum / 3648.0 if total_pcii_sum > 0 else 1.0
    scale_factor = total_pred_pcii / total_avg_pcii if total_avg_pcii > 0 else 1.0
else:
    # station-specific scale_factor
    pred_info = None
    if yearly_predictions_data and selected_station in yearly_predictions_data:
        st_pred = yearly_predictions_data[selected_station]
        month_str = str(curr_month)
        if month_str in st_pred and curr_day in st_pred[month_str] and str(curr_hour) in st_pred[month_str][curr_day]:
            pred_info = st_pred[month_str][curr_day][str(curr_hour)]
            
    if pred_info:
        pred_pcii = pred_info["pcii"]
        st_data = stations_data.get(selected_station, {})
        st_pcii = st_data.get("pcii", 0)
        st_avg_pcii = st_pcii / 3648.0 if st_pcii > 0 else 1.0
        scale_factor = pred_pcii / st_avg_pcii




# ==============================================================================
# TAB 1: OPERATIONS CENTER
# ==============================================================================
with tab_ops:
    # KPI Metrics
    total_violations = df_hotspots['count'].sum() if len(df_hotspots) > 0 else 0
    total_pcii = df_hotspots['pcii'].sum() if len(df_hotspots) > 0 else 0
    avg_pcii = total_pcii / total_violations if total_violations > 0 else 0.0
    hotspots_count = len(df_hotspots)
    
    col_kpi1, col_kpi2, col_kpi3, col_kpi4 = st.columns(4)
    with col_kpi1:
        st.metric("Total Congestion Index (PCII)", f"{total_pcii:,.1f}", help="Sum of Parking Congestion Impact Index")
    with col_kpi2:
        st.metric("Aggregated Violations Count", f"{total_violations:,}", help="Total number of double/obstructive parking violations")
    with col_kpi3:
        st.metric("High-Density Hotspots", f"{hotspots_count}", help="Clustered grid cells containing >= 15 violations")
    with col_kpi4:
        st.metric("Avg Severity Weight", f"{avg_pcii:.2f}", help="Average PCII index value per parking violation")

    # Real-Time Jurisdiction Intel & Patrol Urge
    if selected_station != "All Stations":
        st.write("---")
        st.subheader(f"⚡ Time Slot Predictive Intel: {selected_station}")
        
        # Get yearly predictions
        pred_info = None
        if yearly_predictions_data and selected_station in yearly_predictions_data:
            st_pred = yearly_predictions_data[selected_station]
            month_str = str(curr_month)
            if month_str in st_pred and curr_day in st_pred[month_str] and str(curr_hour) in st_pred[month_str][curr_day]:
                pred_info = st_pred[month_str][curr_day][str(curr_hour)]
                
        if pred_info:
            pred_count = pred_info["count"]
            pred_pcii = pred_info["pcii"]
            urge = pred_info["urge"]
            
            urge_colors = {
                "CRITICAL": "#ff4d4d",
                "HIGH": "#ff944d",
                "MEDIUM": "#ffdb4d",
                "LOW": "#4dff4d"
            }
            urge_descriptions = {
                "CRITICAL": "Extreme congestion & obstructive parking detected. Immediate patrol deployment recommended. Clear arterial pathways and double-yellow lines.",
                "HIGH": "Heavy violation risk. Active patrolling and vehicle clamping teams should be prioritized in this division.",
                "MEDIUM": "Moderate parking violations forecasted. Normal scheduled patrol sweeps are sufficient.",
                "LOW": "Low congestion threat. Routine monitoring and passive camera audits."
            }
            color = urge_colors.get(urge, "#ffffff")
            desc = urge_descriptions.get(urge, "")
            
            col_pred1, col_pred2, col_pred3 = st.columns([1, 1, 1.5])
            with col_pred1:
                st.metric(f"Predicted Violations ({selected_month_name}, {curr_day} at {curr_hour:02d}:00)", f"{pred_count:.1f} / hr", help=f"Estimated offenses")
            with col_pred2:
                st.metric("Predicted Severity (PCII Index)", f"{pred_pcii:.2f}", help="Predicted roadway obstruction impact weight")
            with col_pred3:
                st.markdown(f"""
                <div style="background-color: rgba(255, 255, 255, 0.03); padding: 15px; border-radius: 8px; border-left: 5px solid {color}; margin-top: -5px;">
                    <span style="font-size: 10px; color: #a5b1c2; letter-spacing: 1.5px; font-weight: bold; display: block; margin-bottom: 2px;">PATROL URGE LEVEL</span>
                    <span style="color: {color}; font-family: 'JetBrains Mono', monospace; font-size: 20px; font-weight: 800;">{urge}</span>
                    <p style="font-size: 11px; color: #e1e7f0; margin: 5px 0 0 0; line-height: 1.3;">{desc}</p>
                </div>
                """, unsafe_allow_html=True)
        else:
            st.info("No predictions available for this time slot.")

        # Junction Patrol Urgency & Towing Dispatch
        st.write("---")
        st.subheader(f"📍 Junction Patrol Urgency & Dispatch: {selected_station}")
        st.markdown("Dynamic patrolling recommendation for specific chokepoints (chorahas) rather than the whole division.")
        
        st_junctions = [j for j in junctions_data if j['station'] == selected_station] if junctions_data else []
        if st_junctions:
            for idx, j in enumerate(st_junctions[:6]):  # Show top 6 junctions
                curr_j_pcii = (j['pcii'] / 3648.0) * scale_factor
                
                if curr_j_pcii >= 4.0:
                    j_urgency = "CRITICAL"
                    j_color = "#ff4d4d"
                elif curr_j_pcii >= 2.0:
                    j_urgency = "HIGH"
                    j_color = "#ff944d"
                elif curr_j_pcii >= 0.8:
                    j_urgency = "MEDIUM"
                    j_color = "#ffdb4d"
                else:
                    j_urgency = "LOW"
                    j_color = "#4dff4d"
                
                col_j1, col_j2, col_j3 = st.columns([2, 1, 1])
                with col_j1:
                    st.markdown(f"**{j['name']}**")
                    st.caption(f"Historical Violations: {j['count']} | Cumulative PCII: {j['pcii']:.1f}")
                with col_j2:
                    st.markdown(f"<span style='color: {j_color}; font-weight: bold; font-family: monospace; font-size: 14px;'>● {j_urgency}</span>", unsafe_allow_html=True)
                    st.caption(f"Est. PCII Now: {curr_j_pcii:.2f}")
                with col_j3:
                    btn_key = f"tow_{selected_station}_{j['name']}_{idx}"
                    if st.button("🚨 Call Towing", key=btn_key):
                        timestamp = pd.Timestamp.now('Asia/Kolkata').strftime('%Y-%m-%d %H:%M:%S')
                        new_log = {
                            "Timestamp (IST)": timestamp,
                            "Precinct Division": selected_station,
                            "Junction / Chokepoint": j['name'],
                            "Urgency Level": j_urgency,
                            "Estimated ETA": "12 minutes",
                            "Status": "EN ROUTE"
                        }
                        st.session_state.towing_history.insert(0, new_log)
                        st.success(f"Dispatch order issued! Towing Truck is route to **{j['name']}**. ETA: 12 minutes.")
                st.write("")
        else:
            st.info("No localized junctions registered for this precinct division.")

        # Exact Violations Explorer inside the selected station view
        st.write("---")
        st.subheader("🔍 Exact Violations Explorer")
        st.markdown(f"Historical traffic/parking violation logs for **{curr_day}s** at **{curr_hour:02d}:00**.")
        
        import os
        exact_path = os.path.join(os.path.dirname(__file__), 'web', 'data', 'exact_violations', f'{selected_station}.json')
        if os.path.exists(exact_path):
            with open(exact_path, 'r') as f:
                station_exact = json.load(f)
            
            records = station_exact.get(curr_day, {}).get(str(curr_hour), [])
            if records:
                df_records = pd.DataFrame(records)
                # Format column headers and contents
                df_display = pd.DataFrame()
                df_display['Timestamp (IST)'] = df_records['time']
                df_display['Vehicle Type'] = df_records['vehicle']
                # Join violation lists into string
                df_display['Violations'] = df_records['violations'].apply(lambda l: ", ".join(l) if isinstance(l, list) else str(l))
                df_display['Junction'] = df_records['junction']
                df_display['Status'] = df_records['status'].str.capitalize()
                
                st.dataframe(df_display, use_container_width=True, hide_index=True)
            else:
                st.info(f"No violation logs found for {selected_station} on {curr_day}s during the {curr_hour:02d}:00 - {(curr_hour+1)%24:02d}:00 window.")
        else:
            st.error("Exact violations database file not found for this precinct.")
    else:
        st.write("---")
        st.info("ℹ️ To use the Real-Time Predictive Intel & Exact Violations Explorer, please select a specific precinct jurisdiction in the sidebar.")

    # Map and Schedules
    st.write("---")
    col_map, col_list = st.columns([2, 1])
    
    with col_map:
        st.subheader("Geospatial Hotspot Map")
        if selected_station != "All Stations" and len(df_hotspots) > 0:
            map_center = [df_hotspots['lat'].mean(), df_hotspots['lng'].mean()]
            zoom_start = 14
        else:
            map_center = [12.9716, 77.5946]
            zoom_start = 12
            
        m = folium.Map(location=map_center, zoom_start=zoom_start, tiles="Cartodb dark_matter")
        
        # Plot top 200 hotspots scaled dynamically based on ML predictions
        for idx, row in df_hotspots.nlargest(200, 'count').iterrows():
            curr_count = (row['count'] / 3648.0) * scale_factor * 100
            curr_pcii_avg = row['avg_pcii'] * scale_factor
            
            # Determine color based on scaled average PCII
            if curr_pcii_avg > 7.0:
                color = "#ff5252" # Critical (Red)
            elif curr_pcii_avg > 3.0:
                color = "#ff9f43" # High (Orange)
            elif curr_pcii_avg > 1.0:
                color = "#feca57" # Medium (Yellow)
            else:
                color = "#00f2fe" # Low (Teal)
                
            radius = min(30, max(6, float(curr_count) * 2.0))
            
            folium.CircleMarker(
                location=[row['lat'], row['lng']],
                radius=radius,
                color=color,
                fill=True,
                fill_opacity=0.6,
                popup=f"<b>Hotspot Details</b><br>Station: {row['station']}<br>Est. Hourly Violations: {curr_count:.2f}/hr<br>Est. PCII Severity: {curr_pcii_avg:.2f}<br>Primary Vehicle: {row['primary_vehicle']}"
            ).add_to(m)
            
        # Plot top 30 junctions on the map, dynamically colored by patrolling urgency
        for idx, row in df_junctions.nlargest(30, 'count').iterrows():
            curr_j_pcii = (row['pcii'] / 3648.0) * scale_factor
            if curr_j_pcii >= 4.0:
                icon_color = "red" # Critical
            elif curr_j_pcii >= 2.0:
                icon_color = "orange" # High
            elif curr_j_pcii >= 0.8:
                icon_color = "cadetblue" # Medium
            else:
                icon_color = "blue" # Low
                
            folium.Marker(
                location=[row['lat'], row['lng']],
                icon=folium.Icon(color=icon_color, icon="warning", prefix="fa"),
                popup=f"<b>Junction Chokepoint</b><br>Name: {row['name']}<br>Historical Count: {row['count']}<br>Est. PCII Now: {curr_j_pcii:.2f}"
            ).add_to(m)
            
        folium_static(m, height=450, width=800)
        
    with col_list:
        st.subheader("Patrol Priority Schedule")
        # Get junctions and calculate real-time estimated PCII and priority
        st_junctions = [j for j in junctions_data if j['station'] == selected_station] if selected_station != "All Stations" else junctions_data
        
        recs = []
        for j in st_junctions:
            curr_j_pcii = (j['pcii'] / 3648.0) * scale_factor
            
            priority = "LOW"
            if curr_j_pcii >= 4.0:
                priority = "CRITICAL"
            elif curr_j_pcii >= 2.0:
                priority = "HIGH"
            elif curr_j_pcii >= 0.8:
                priority = "MEDIUM"
                
            # Determine action
            viol = str(j.get('primary_violation', '')).upper()
            action = "Routine Patrol"
            if "DOUBLE" in viol:
                action = "Double Parking Towing Sweep"
            elif "MAIN ROAD" in viol:
                action = "Active Lane Clamping"
            elif "FOOTPATH" in viol:
                action = "Clear Footpath Obstructions"
            elif "NO PARKING" in viol:
                action = "Parking Enforcement & Fine"
            elif "WRONG" in viol:
                action = "Obstructive Vehicle Clamping"
                
            end_hour = (curr_hour + 1) % 24
            window_str = f"{curr_hour:02d}:00 - {end_hour:02d}:00"
            
            recs.append({
                "Station": j['station'],
                "Priority": priority,
                "Location": j['name'],
                "Peak Day": curr_day,
                "Window": window_str,
                "Enforcement Action": action,
                "pcii_val": curr_j_pcii
            })
            
        # Convert to DataFrame and display
        if recs:
            df_recs = pd.DataFrame(recs)
            df_display = df_recs.sort_values(by="pcii_val", ascending=False).head(10)[["Station", "Priority", "Location", "Peak Day", "Window", "Enforcement Action"]]
            st.dataframe(df_display, use_container_width=True, hide_index=True)
        else:
            st.info("No active schedules match the current jurisdiction filter.")

    # Charts
    st.write("---")
    st.subheader("Data Visualization Panels")
    col_c1, col_c2 = st.columns(2)
    
    # 1. Hourly profile sum
    if selected_station == "All Stations":
        hourly_dist = [0] * 24
        vehicles_dict = {}
        for st_name, st_val in stations_data.items():
            for h in range(24):
                hourly_dist[h] += st_val.get("hourly_dist", [0]*24)[h]
            for v_name, v_val in st_val.get("vehicles", {}).items():
                vehicles_dict[v_name] = vehicles_dict.get(v_name, 0) + v_val
        predictions = [0.0] * 7
        for st_name, pred_val in predictions_data.items():
            for d in range(7):
                predictions[d] += pred_val[d]
    else:
        st_val = stations_data[selected_station]
        hourly_dist = st_val.get("hourly_dist", [0]*24)
        vehicles_dict = st_val.get("vehicles", {})
        predictions = predictions_data.get(selected_station, [0.0]*7)
        
    with col_c1:
        st.markdown("**Hourly Congestion wave (IST)**")
        df_hourly = pd.DataFrame({
            "Hour": [f"{h:02d}:00" for h in range(24)],
            "Violations": hourly_dist
        })
        fig_hourly = px.bar(df_hourly, x="Hour", y="Violations", color="Violations", template="plotly_dark", color_continuous_scale="Viridis")
        fig_hourly.update_layout(showlegend=False, height=280, margin=dict(l=10, r=10, t=10, b=10))
        st.plotly_chart(fig_hourly, use_container_width=True)
        
    with col_c2:
        st.markdown("**Vehicle Offence Footprint Share**")
        df_vehicles = pd.DataFrame({
            "Vehicle Type": list(vehicles_dict.keys()),
            "Violations": list(vehicles_dict.values())
        })
        fig_vehicles = px.pie(df_vehicles, names="Vehicle Type", values="Violations", hole=0.4, template="plotly_dark")
        fig_vehicles.update_layout(height=280, margin=dict(l=10, r=10, t=10, b=10))
        st.plotly_chart(fig_vehicles, use_container_width=True)
        
    st.markdown("**Next-Week Seasonal Risk Forecast profile (PCII)**")
    df_preds = pd.DataFrame({
        "Day of Week": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        "Predicted PCII Severity": predictions
    })
    fig_preds = px.area(df_preds, x="Day of Week", y="Predicted PCII Severity", template="plotly_dark", color_discrete_sequence=["#00f2fe"])
    fig_preds.update_layout(height=240, margin=dict(l=10, r=10, t=10, b=10))
    st.plotly_chart(fig_preds, use_container_width=True)

    # Towing Dispatch Logs / History Section
    st.write("---")
    st.subheader("🚨 Towing Dispatch History Log")
    if st.session_state.towing_history:
        df_history = pd.DataFrame(st.session_state.towing_history)
        st.dataframe(df_history, use_container_width=True, hide_index=True)
    else:
        st.info("No towing trucks dispatched yet. Click 'Call Towing' in the junction list to issue dispatch orders.")
