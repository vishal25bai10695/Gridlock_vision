// Gridlock Vision App Logic
document.addEventListener('DOMContentLoaded', () => {
    // Global Application State
    const state = {
        summary: null,
        hotspots: [],
        junctions: [],
        stations: {},
        trends: {},
        recommendations: {},
        predictions: {},
        yearlyPredictions: {},
        cachedExactViolations: { station: null, data: null },

        
        // Filter States
        selectedStation: 'ALL',
        selectedMonth: 1,
        selectedDay: 'Monday',
        selectedHour: 12,
        currentScaleFactor: 1.0,
        mapMode: 'hotspots', // hotspots or junctions
        
        // UI Instances
        map: null,
        mapLayers: {
            hotspots: L.layerGroup(),
            junctions: L.layerGroup()
        },
        charts: {
            hourly: null,
            vehicles: null,
            forecast: null
        }
    };

    // Initialize DateTime
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Load Datasets from JSON
    async function loadData() {
        try {
            const fetchJson = async (url) => {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return await response.json();
            };

            state.summary = await fetchJson('data/summary_stats.json');
            state.hotspots = await fetchJson('data/hotspots.json');
            state.junctions = await fetchJson('data/junctions.json');
            state.stations = await fetchJson('data/police_stations.json');
            state.trends = await fetchJson('data/temporal_trends.json');
            state.recommendations = await fetchJson('data/recommendations.json');
            state.predictions = await fetchJson('data/predictions.json');
            state.yearlyPredictions = await fetchJson('data/yearly_predictions.json');

            console.log('Gridlock Vision: All datasets loaded successfully.');
            
            // Populate Police Station Selector
            populateStationSelector();
            
            // Initialize Leaflet Map
            initMap();
            
            // Initialize Chart.js
            initCharts();
            
            // Initialize global temporal query filters with current IST time
            const istNow = getISTTime();
            state.selectedMonth = istNow.month;
            state.selectedDay = istNow.dayName;
            state.selectedHour = istNow.hour;
            
            // Sync sidebar DOM elements to match these initial values
            const queryMonthEl = document.getElementById('query-month');
            const queryDayEl = document.getElementById('query-day');
            const queryHourSliderEl = document.getElementById('query-hour-slider');
            const queryHourLabelEl = document.getElementById('query-hour-label');
            if (queryMonthEl) queryMonthEl.value = state.selectedMonth;
            if (queryDayEl) queryDayEl.value = state.selectedDay;
            if (queryHourSliderEl) queryHourSliderEl.value = state.selectedHour;
            if (queryHourLabelEl) queryHourLabelEl.textContent = String(state.selectedHour).padStart(2, '0') + ':00';

            // Render UI
            updateDashboard();

            // Setup Filter Event Listeners
            setupEventListeners();
            
        } catch (error) {
            console.error('Error loading data assets:', error);
            alert('Failed to load preprocessed data assets. Please ensure python3 preprocess.py has run successfully.');
        }
    }

    // Update Live Clock (IST)
    function updateDateTime() {
        const timeEl = document.getElementById('current-time');
        const dateEl = document.getElementById('current-date');
        if (!timeEl || !dateEl) return;
        
        const now = new Date();
        // Format to IST timezone manually
        const optionsTime = { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Kolkata', hour12: true };
        const optionsDate = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Kolkata' };
        
        timeEl.textContent = now.toLocaleTimeString('en-US', optionsTime) + ' IST';
        dateEl.textContent = now.toLocaleDateString('en-US', optionsDate);
    }

    // Populate drop down options
    function populateStationSelector() {
        const select = document.getElementById('station-select');
        if (!select) return;

        // Sort station names alphabetically
        const sortedStations = Object.keys(state.stations).sort();
        
        sortedStations.forEach(station => {
            const opt = document.createElement('option');
            opt.value = station;
            opt.textContent = `${station} Police Station`;
            select.appendChild(opt);
        });
    }

    // Setup filter listeners
    function setupEventListeners() {
        // Jurisdiction Dropdown
        document.getElementById('station-select').addEventListener('change', (e) => {
            state.selectedStation = e.target.value;
            updateDashboard();
        });

        // Month Selector
        const queryMonth = document.getElementById('query-month');
        if (queryMonth) {
            queryMonth.addEventListener('change', (e) => {
                state.selectedMonth = parseInt(e.target.value);
                updateDashboard();
            });
        }

        // Day Selector
        const queryDay = document.getElementById('query-day');
        if (queryDay) {
            queryDay.addEventListener('change', (e) => {
                state.selectedDay = e.target.value;
                updateDashboard();
            });
        }

        // Hour Slider
        const queryHourSlider = document.getElementById('query-hour-slider');
        const queryHourLabel = document.getElementById('query-hour-label');
        if (queryHourSlider && queryHourLabel) {
            queryHourSlider.addEventListener('input', (e) => {
                const hr = String(e.target.value).padStart(2, '0') + ':00';
                queryHourLabel.textContent = hr;
            });
            queryHourSlider.addEventListener('change', (e) => {
                state.selectedHour = parseInt(e.target.value);
                updateDashboard();
            });
        }

        // Map layer buttons
        document.getElementById('btn-show-hotspots').addEventListener('click', (e) => {
            document.getElementById('btn-show-hotspots').classList.add('active');
            document.getElementById('btn-show-junctions').classList.remove('active');
            state.mapMode = 'hotspots';
            renderMapLayers();
        });

        document.getElementById('btn-show-junctions').addEventListener('click', (e) => {
            document.getElementById('btn-show-junctions').classList.add('active');
            document.getElementById('btn-show-hotspots').classList.remove('active');
            state.mapMode = 'junctions';
            renderMapLayers();
        });

        // Export Patrol Order Button
        document.getElementById('btn-export-schedule').addEventListener('click', () => {
            exportPatrolSchedule();
        });
    }

    // Initialize Map
    function initMap() {
        // Coordinates for Central Bengaluru
        const centerLatLng = [12.9785, 77.5935];
        
        state.map = L.map('map', {
            center: centerLatLng,
            zoom: 12,
            zoomControl: true,
            minZoom: 10,
            maxZoom: 17
        });

        // Add CartoDB Dark Matter map layer
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(state.map);

        // Add layer groups to map
        state.mapLayers.hotspots.addTo(state.map);
    }

    function matchesTemporalFilter(peakDay, peakHour) {
        const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const selectedDayCat = weekdays.includes(state.selectedDay) ? 'WD' : 'WE';
        const peakDayCat = weekdays.includes(peakDay) ? 'WD' : 'WE';
        
        if (selectedDayCat !== peakDayCat) return false;
        
        let selectedTimeCat = 'OFF_PEAK';
        if (state.selectedHour >= 8 && state.selectedHour <= 11) selectedTimeCat = 'AM_PEAK';
        else if (state.selectedHour >= 17 && state.selectedHour <= 20) selectedTimeCat = 'PM_PEAK';
        
        let peakTimeCat = 'OFF_PEAK';
        if (peakHour >= 8 && peakHour <= 11) peakTimeCat = 'AM_PEAK';
        else if (peakHour >= 17 && peakHour <= 20) peakTimeCat = 'PM_PEAK';
        
        return selectedTimeCat === peakTimeCat;
    }

    // Draw Map Objects
    function renderMapLayers() {
        // Clear layers
        state.mapLayers.hotspots.clearLayers();
        state.mapLayers.junctions.clearLayers();

        if (state.mapMode === 'hotspots') {
            // Remove junctions layer from map if present
            state.map.removeLayer(state.mapLayers.junctions);
            state.map.addLayer(state.mapLayers.hotspots);

            // Filter hotspots by station only (always display, scale dynamically)
            const filteredHotspots = state.hotspots.filter(h => {
                // Station filter
                if (state.selectedStation !== 'ALL' && h.station !== state.selectedStation) return false;
                return true;
            });

            const scaleFactor = state.currentScaleFactor;

            filteredHotspots.forEach(h => {
                // Scale count and average PCII for this hour
                const currCount = (h.count / 3648.0) * scaleFactor * 5000;
                const currPciiAvg = h.avg_pcii * scaleFactor;

                // Determine color based on scaled average PCII
                let color = '#00f2fe'; // Low (Teal)
                if (currPciiAvg > 7.0) color = '#ff0844'; // Critical (Red)
                else if (currPciiAvg > 3.0) color = '#ff9f43'; // High (Orange)
                else if (currPciiAvg > 1.0) color = '#feca57'; // Medium (Yellow)

                // Radius represents violation density (scaled)
                const radius = Math.max(30, Math.min(220, currCount));

                const circle = L.circle([h.lat, h.lng], {
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.45,
                    weight: 1.5,
                    radius: radius
                });

                const popupContent = `
                    <div class="map-popup-title">${h.station} Jurisdiction</div>
                    <div class="map-popup-body">
                        <div class="map-popup-row">
                            <span class="map-popup-label">Violations Count:</span>
                            <span class="map-popup-value">${h.count.toLocaleString()}</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Traffic Impact (PCII):</span>
                            <span class="map-popup-value" style="color:#ff7675">${Math.round(h.pcii).toLocaleString()}</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Avg Blockage Score:</span>
                            <span class="map-popup-value">${h.avg_pcii.toFixed(1)}</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Peak Time:</span>
                            <span class="map-popup-value" style="color:#00f2fe">${h.peak_day}, ${h.peak_hour.toString().padStart(2, '0')}:00</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Top Vehicle type:</span>
                            <span class="map-popup-value">${h.primary_vehicle}</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Primary Infraction:</span>
                            <span class="map-popup-value" style="font-size:0.9em">${h.primary_violation}</span>
                        </div>
                    </div>
                `;

                circle.bindPopup(popupContent);
                state.mapLayers.hotspots.addLayer(circle);
            });

            // Adjust map view bounds to encompass filtered hotspots if single station is selected
            if (state.selectedStation !== 'ALL' && filteredHotspots.length > 0) {
                const group = new L.featureGroup(filteredHotspots.map(h => L.marker([h.lat, h.lng])));
                state.map.fitBounds(group.getBounds().pad(0.1));
            } else if (state.selectedStation === 'ALL') {
                state.map.setView([12.9785, 77.5935], 12);
            }

        } else if (state.mapMode === 'junctions') {
            // Remove hotspots layer from map if present
            state.map.removeLayer(state.mapLayers.hotspots);
            state.map.addLayer(state.mapLayers.junctions);

            const filteredJunctions = state.junctions.filter(j => {
                if (state.selectedStation !== 'ALL' && j.station !== state.selectedStation) return false;
                return true;
            });

            const scaleFactor = state.currentScaleFactor;

            filteredJunctions.forEach(j => {
                // Scale estimated PCII based on ML scale factor
                const currJPcii = (j.pcii / 3648.0) * scaleFactor;

                // Circle Marker pins for junctions scaled by predicted urgency
                let color = '#0072ff'; // Royal Blue (Low)
                if (currJPcii > 4.0) color = '#ff0844'; // Critical (Red)
                else if (currJPcii > 2.0) color = '#ff9f43'; // High (Orange)
                else if (currJPcii > 0.8) color = '#feca57'; // Medium (Yellow)

                const marker = L.circleMarker([j.lat, j.lng], {
                    radius: 8,
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.85,
                    weight: 2
                });

                const popupContent = `
                    <div class="map-popup-title">${j.name}</div>
                    <div class="map-popup-body">
                        <div class="map-popup-row">
                            <span class="map-popup-label">Violations Count:</span>
                            <span class="map-popup-value">${j.count.toLocaleString()}</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Traffic Impact (PCII):</span>
                            <span class="map-popup-value" style="color:#ff7675">${Math.round(j.pcii).toLocaleString()}</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Station:</span>
                            <span class="map-popup-value">${j.station}</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Peak Time:</span>
                            <span class="map-popup-value" style="color:#00f2fe">${j.peak_day}, ${j.peak_hour}:00</span>
                        </div>
                        <div class="map-popup-row">
                            <span class="map-popup-label">Busiest Vehicle:</span>
                            <span class="map-popup-value">${j.primary_vehicle}</span>
                        </div>
                    </div>
                `;

                marker.bindPopup(popupContent);
                state.mapLayers.junctions.addLayer(marker);
            });

            if (state.selectedStation !== 'ALL' && filteredJunctions.length > 0) {
                const group = new L.featureGroup(filteredJunctions.map(j => L.marker([j.lat, j.lng])));
                state.map.fitBounds(group.getBounds().pad(0.1));
            }
        }
    }

    // Initialize Chart.js Instances
    function initCharts() {
        // 1. Hourly Congestion Wave Line Chart
        const ctxHourly = document.getElementById('chart-hourly').getContext('2d');
        state.charts.hourly = new Chart(ctxHourly, {
            type: 'line',
            data: {
                labels: Array.from({length: 24}, (_, i) => `${i.toString().padStart(2, '0')}:00`),
                datasets: [{
                    label: 'Traffic Congestion (PCII)',
                    data: [],
                    borderColor: '#ff0844',
                    borderWidth: 3,
                    pointBackgroundColor: '#ff0844',
                    pointHoverRadius: 6,
                    tension: 0.35,
                    yAxisID: 'y'
                }, {
                    label: 'Violations Count',
                    data: [],
                    borderColor: '#00f2fe',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    pointBackgroundColor: '#00f2fe',
                    tension: 0.3,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', weight: 500 } }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: '#6b7280' }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#ff7675' },
                        title: { display: true, text: 'Cumulative PCII', color: '#ff7675' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#00f2fe' },
                        title: { display: true, text: 'Raw Tickets Issued', color: '#00f2fe' }
                    }
                }
            }
        });

        // 2. Vehicle Obstruction Horizontal Bar Chart
        const ctxVehicles = document.getElementById('chart-vehicles').getContext('2d');
        state.charts.vehicles = new Chart(ctxVehicles, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Obstruction Index',
                    data: [],
                    backgroundColor: 'rgba(127, 0, 255, 0.65)',
                    borderColor: '#7f00ff',
                    borderWidth: 1.5,
                    borderRadius: 5,
                    borderSkipped: false
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: '#6b7280' }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });

        // 3. Risk Forecast Chart
        const ctxForecast = document.getElementById('chart-forecast').getContext('2d');
        state.charts.forecast = new Chart(ctxForecast, {
            type: 'line',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                datasets: [{
                    label: 'Forecast Risk Index',
                    data: [],
                    borderColor: '#ff9f43',
                    borderWidth: 3,
                    fill: true,
                    backgroundColor: 'rgba(255, 159, 67, 0.05)',
                    pointBackgroundColor: '#ff9f43',
                    pointHoverRadius: 6,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: '#6b7280' }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: { color: '#9ca3af' }
                    }
                }
            }
        });
    }

    // Refresh UI Components on Filter Update
    function updateDashboard() {
        const isAll = state.selectedStation === 'ALL';
        
        // Calculate dynamic ML scale factor based on predictions
        let scaleFactor = 1.0;
        if (isAll) {
            let totalPredPcii = 0;
            let totalAvgPcii = 0;
            
            for (const stName in state.yearlyPredictions) {
                const stPred = state.yearlyPredictions[stName];
                const monthStr = String(state.selectedMonth);
                if (stPred[monthStr] && stPred[monthStr][state.selectedDay] && stPred[monthStr][state.selectedDay][String(state.selectedHour)]) {
                    totalPredPcii += stPred[monthStr][state.selectedDay][String(state.selectedHour)].pcii;
                }
            }
            
            let totalPciiSum = 0;
            for (const stName in state.stations) {
                totalPciiSum += state.stations[stName].pcii || 0;
            }
            totalAvgPcii = totalPciiSum > 0 ? (totalPciiSum / 3648.0) : 1.0;
            scaleFactor = totalPredPcii / totalAvgPcii;
        } else {
            let predInfo = null;
            if (state.yearlyPredictions && state.yearlyPredictions[state.selectedStation]) {
                const stPred = state.yearlyPredictions[state.selectedStation];
                const monthStr = String(state.selectedMonth);
                if (stPred[monthStr] && stPred[monthStr][state.selectedDay] && stPred[monthStr][state.selectedDay][String(state.selectedHour)]) {
                    predInfo = stPred[monthStr][state.selectedDay][String(state.selectedHour)];
                }
            }
            if (predInfo) {
                const stData = state.stations[state.selectedStation];
                const stPcii = stData ? stData.pcii : 0;
                const stAvgPcii = stPcii > 0 ? (stPcii / 3648.0) : 1.0;
                scaleFactor = predInfo.pcii / stAvgPcii;
            }
        }
        state.currentScaleFactor = scaleFactor;

        // Update Titles
        document.getElementById('view-title').textContent = isAll ? 'Bengaluru City Overview' : `${state.selectedStation} Police Station`;
        document.getElementById('view-subtitle').textContent = isAll 
            ? 'Spatio-Temporal Aggregates & Targeted Enforcement Actions'
            : `Local Patrol Orders & Sector Congestion Scoring`;
            
        // Calculate Metrics
        let violationsCount = 0;
        let pciiSum = 0;
        let activeHotspots = 0;
        let junctionsCount = 0;

        if (isAll) {
            violationsCount = state.summary.total_violations;
            pciiSum = state.summary.total_pcii;
            activeHotspots = state.summary.hotspots_count;
            junctionsCount = state.summary.junctions_count;
            
            document.getElementById('kpi-hotspots-caption').textContent = 'Grid cells (110m)';
            document.getElementById('kpi-junctions-caption').textContent = 'Assigned locations';
        } else {
            const stationData = state.stations[state.selectedStation];
            violationsCount = stationData.count;
            pciiSum = stationData.pcii;
            
            // Count local hotspots
            activeHotspots = state.hotspots.filter(h => h.station === state.selectedStation).length;
            // Count local junctions
            junctionsCount = state.junctions.filter(j => j.station === state.selectedStation).length;
            
            document.getElementById('kpi-hotspots-caption').textContent = 'Station Hotspots';
            document.getElementById('kpi-junctions-caption').textContent = 'Station Junctions';
        }

        // Set KPI Numbers
        document.getElementById('kpi-violations').textContent = violationsCount.toLocaleString();
        document.getElementById('kpi-pcii').textContent = Math.round(pciiSum).toLocaleString();
        document.getElementById('kpi-hotspots').textContent = activeHotspots.toLocaleString();
        document.getElementById('kpi-junctions').textContent = junctionsCount.toLocaleString();

        // Update Junction Leaderboard Table
        updateLeaderboardTable();

        // Update Charts
        updateChartsData();

        // Draw Map circles/markers
        renderMapLayers();

        // Populate patrol schedules table
        updatePatrolScheduler();

        // Update ML real-time predictions and exact violations
        updateRealTimePredictions();
        updateExplorerTable();
    }

    // Helper to get current IST time
    function getISTTime() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
            hour12: false
        });
        const parts = formatter.formatToParts(now);
        const dateObj = {};
        parts.forEach(p => { dateObj[p.type] = p.value; });
        
        const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' });
        const dayName = dayFormatter.format(now);
        
        return {
            year: parseInt(dateObj.year),
            month: parseInt(dateObj.month),
            day: parseInt(dateObj.day),
            hour: parseInt(dateObj.hour),
            dayName: dayName
        };
    }

    // Refresh ML real-time predictions panel
    function updateRealTimePredictions() {
        const isAll = state.selectedStation === 'ALL';
        const panel = document.getElementById('prediction-panel');
        if (!panel) return;

        if (isAll) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';
        
        let predInfo = null;
        if (state.yearlyPredictions && state.yearlyPredictions[state.selectedStation]) {
            const stPred = state.yearlyPredictions[state.selectedStation];
            const monthStr = String(state.selectedMonth);
            if (stPred[monthStr] && stPred[monthStr][state.selectedDay] && stPred[monthStr][state.selectedDay][String(state.selectedHour)]) {
                predInfo = stPred[monthStr][state.selectedDay][String(state.selectedHour)];
            }
        }

        const countEl = document.getElementById('pred-violations-count');
        const pciiEl = document.getElementById('pred-pcii-val');
        const levelEl = document.getElementById('pred-urge-level');
        const descEl = document.getElementById('pred-urge-desc');
        const cardEl = document.getElementById('pred-urge-card');

        // Update the card sub-header text
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const monthName = monthNames[state.selectedMonth - 1] || '';
        const subtitleEl = panel.querySelector('.card-header p');
        if (subtitleEl) {
            subtitleEl.textContent = `Predicted traffic violations and patrol urgency for ${monthName}, ${state.selectedDay} at ${String(state.selectedHour).padStart(2, '0')}:00`;
        }

        if (predInfo) {
            countEl.textContent = `${predInfo.count.toFixed(1)} / hr`;
            pciiEl.textContent = predInfo.pcii.toFixed(2);
            levelEl.textContent = predInfo.urge;

            let urgeColor = '#ffffff';
            let urgeDesc = '';
            if (predInfo.urge === 'CRITICAL') {
                urgeColor = 'var(--badge-critical)';
                urgeDesc = 'Extreme congestion & obstructive parking detected. Immediate patrol deployment recommended. Clear arterial pathways and double-yellow lines.';
            } else if (predInfo.urge === 'HIGH') {
                urgeColor = 'var(--badge-high)';
                urgeDesc = 'Heavy violation risk. Active patrolling and vehicle clamping teams should be prioritized in this division.';
            } else if (predInfo.urge === 'MEDIUM') {
                urgeColor = 'var(--badge-medium)';
                urgeDesc = 'Moderate parking violations forecasted. Normal scheduled patrol sweeps are sufficient.';
            } else {
                urgeColor = 'var(--text-secondary)';
                urgeDesc = 'Low congestion threat. Routine monitoring and passive camera audits.';
            }

            levelEl.style.color = urgeColor;
            cardEl.style.borderLeftColor = urgeColor;
            descEl.textContent = urgeDesc;
        } else {
            countEl.textContent = '-';
            pciiEl.textContent = '-';
            levelEl.textContent = '-';
            levelEl.style.color = 'var(--text-secondary)';
            cardEl.style.borderLeftColor = '#ffffff';
            descEl.textContent = 'No real-time predictions available for this station.';
        }
    }



    // Refresh Exact Violations Explorer table
    async function updateExplorerTable() {
        const isAll = state.selectedStation === 'ALL';
        const panel = document.getElementById('explorer-panel');
        const tbody = document.getElementById('explorer-tbody');
        if (!panel || !tbody) return;

        if (isAll) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';

        const selectedDay = state.selectedDay;
        const selectedHour = String(state.selectedHour);

        // Update the active context subtext description
        const activeDescEl = document.getElementById('explorer-active-desc');
        if (activeDescEl) {
            activeDescEl.textContent = `${selectedDay} at ${selectedHour.padStart(2, '0')}:00`;
        }

        tbody.innerHTML = `<tr><td colspan="5" class="text-center"><span class="pulse-dot" style="margin-right:8px;"></span>Loading exact violation logs...</td></tr>`;

        try {
            // Load station records on demand (cached)
            if (state.cachedExactViolations.station !== state.selectedStation) {
                const response = await fetch(`data/exact_violations/${state.selectedStation}.json`);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                state.cachedExactViolations.data = await response.json();
                state.cachedExactViolations.station = state.selectedStation;
            }

            const records = (state.cachedExactViolations.data[selectedDay] && state.cachedExactViolations.data[selectedDay][selectedHour]) || [];

            if (records.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color: var(--text-secondary);">No violations recorded for this station on ${selectedDay}s at ${selectedHour.padStart(2, '0')}:00.</td></tr>`;
                return;
            }

            tbody.innerHTML = '';
            records.forEach(r => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-family: 'JetBrains Mono', monospace; font-size: 0.85em;">${r.time}</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-weight: 500;">${r.vehicle}</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-size: 0.9em; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.violations.join(', ')}">${r.violations.join(', ')}</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color); font-size: 0.9em; color: var(--text-secondary);">${r.junction}</td>
                    <td style="padding: 12px 16px; border-bottom: 1px solid var(--border-color);"><span class="priority-badge ${r.status === 'approved' ? 'HIGH' : 'LOW'}" style="padding: 2px 8px; border-radius: 4px; font-size: 0.75em; text-transform: uppercase;">${r.status}</span></td>
                `;
                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error('Error fetching exact violations:', error);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color: var(--badge-critical);">Failed to load exact violation records for this precinct.</td></tr>`;
        }
    }

    // Render Busiest Junctions list
    function showToast(message) {
        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.right = '20px';
        toast.style.backgroundColor = 'var(--bg-sidebar)';
        toast.style.borderLeft = '5px solid var(--accent-teal)';
        toast.style.color = 'var(--text-primary)';
        toast.style.padding = '12px 20px';
        toast.style.borderRadius = '4px';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
        toast.style.zIndex = '9999';
        toast.style.fontFamily = 'inherit';
        toast.style.fontSize = '0.9em';
        toast.textContent = message;
        
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s ease';
            setTimeout(() => toast.remove(), 500);
        }, 3000);
    }

    function getJunctionTemporalWeight(hour) {
        if ([8, 9, 10, 11, 17, 18, 19, 20].includes(hour)) return 2.5;
        if ([12, 13, 16].includes(hour)) return 1.5;
        if ([7, 14, 15, 21, 22].includes(hour)) return 1.0;
        return 0.5;
    }

    function updateLeaderboardTable() {
        const tbody = document.querySelector('#junction-leaderboard tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        // Filter junctions
        const filteredJunctions = state.junctions.filter(j => {
            if (state.selectedStation !== 'ALL' && j.station !== state.selectedStation) return false;
            return true;
        });

        // Take top 10
        const top10 = filteredJunctions.slice(0, 10);

        if (top10.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center">No congested junctions registered for this division.</td></tr>`;
            return;
        }

        const scaleFactor = state.currentScaleFactor;

        top10.forEach((j, index) => {
            const tr = document.createElement('tr');
            
            let rankClass = '';
            if (index === 0) rankClass = 'top-1';
            else if (index === 1) rankClass = 'top-2';
            else if (index === 2) rankClass = 'top-3';

            // Calculate urgency using scaleFactor derived from ML predictions
            const currJ_pcii = (j.pcii / 3648.0) * scaleFactor;
            let urgency = 'LOW';
            let urgeColor = 'var(--text-secondary)';
            if (currJ_pcii >= 4.0) {
                urgency = 'CRITICAL';
                urgeColor = 'var(--badge-critical)';
            } else if (currJ_pcii >= 2.0) {
                urgency = 'HIGH';
                urgeColor = 'var(--badge-high)';
            } else if (currJ_pcii >= 0.8) {
                urgency = 'MEDIUM';
                urgeColor = 'var(--badge-medium)';
            }

            tr.innerHTML = `
                <td class="leaderboard-rank ${rankClass}">#${index + 1}</td>
                <td>
                    <span class="leaderboard-name" style="cursor:pointer;" title="Zoom on Map">${j.name}</span>
                    <span class="zone-type" style="font-size:0.65em;">${j.station} Division</span>
                </td>
                <td>
                    <span style="color: ${urgeColor}; font-weight: 700; font-family: 'JetBrains Mono', monospace; font-size: 0.85em;">● ${urgency}</span>
                </td>
                <td>
                    <button class="btn-action dispatch-tow-btn" style="padding: 4px 10px; font-size: 0.8em; margin: 0; background-color: var(--accent-coral); border: none; border-radius: 4px; cursor: pointer; color: white;" data-junction="${j.name}">🚨 Call Towing</button>
                </td>
            `;

            // Row click zoom behavior
            tr.querySelector('.leaderboard-name').addEventListener('click', () => {
                state.map.setView([j.lat, j.lng], 15);
                // Open popup manually
                state.mapLayers.junctions.eachLayer(layer => {
                    const latlng = layer.getLatLng();
                    if (latlng.lat === j.lat && latlng.lng === j.lng) {
                        layer.openPopup();
                    }
                });
            });

            // Dispatch towing truck event listener
            tr.querySelector('.dispatch-tow-btn').addEventListener('click', (e) => {
                const jName = e.target.dataset.junction;
                showToast(`Dispatch order issued! Towing Truck is route to ${jName}. ETA: 10 mins.`);
            });

            tbody.appendChild(tr);
        });
    }

    // Update charts data binding
    function updateChartsData() {
        const isAll = state.selectedStation === 'ALL';
        
        // 1. Hourly Chart Updates
        let hourlyPCII = [];
        let hourlyCount = [];
        
        if (isAll) {
            // Accumulate from all stations
            hourlyCount = state.trends.hourly;
            // Since we didn't save overall hourly PCII directly in stats, we compute a representation or load from trends
            // To match, we can aggregate PCII from stations or approximate.
            hourlyPCII = Array(24).fill(0);
            Object.values(state.stations).forEach(st => {
                for (let h = 0; h < 24; h++) {
                    // Approximate PCII wave profile scaled to station weight
                    hourlyPCII[h] += st.hourly_dist[h] * st.avg_pcii;
                }
            });
        } else {
            const st = state.stations[state.selectedStation];
            hourlyCount = st.hourly_dist;
            hourlyPCII = st.hourly_dist.map(tickets => tickets * st.avg_pcii);
        }

        state.charts.hourly.data.datasets[0].data = hourlyPCII;
        state.charts.hourly.data.datasets[1].data = hourlyCount;
        state.charts.hourly.update();

        // 2. Vehicle Chart Updates
        let vehicleLabels = [];
        let vehicleData = [];

        if (isAll) {
            // Aggregate from all stations
            const allVehicles = {};
            Object.values(state.stations).forEach(st => {
                Object.entries(st.vehicles).forEach(([vName, vCount]) => {
                    allVehicles[vName] = (allVehicles[vName] || 0) + vCount;
                });
            });
            
            // Sort by count
            const sortedVeh = Object.entries(allVehicles).sort((a, b) => b[1] - a[1]).slice(0, 7);
            vehicleLabels = sortedVeh.map(x => x[0]);
            vehicleData = sortedVeh.map(x => x[1]);
        } else {
            const st = state.stations[state.selectedStation];
            const sortedVeh = Object.entries(st.vehicles).sort((a, b) => b[1] - a[1]).slice(0, 7);
            vehicleLabels = sortedVeh.map(x => x[0]);
            vehicleData = sortedVeh.map(x => x[1]);
        }

        state.charts.vehicles.data.labels = vehicleLabels;
        state.charts.vehicles.data.datasets[0].data = vehicleData;
        state.charts.vehicles.update();

        // 3. Forecast Chart Updates
        let forecastData = [];
        if (isAll) {
            // Sum predictions from all stations
            forecastData = Array(7).fill(0);
            Object.values(state.predictions).forEach(pred => {
                for (let d = 0; d < 7; d++) {
                    forecastData[d] += pred[d];
                }
            });
        } else {
            forecastData = state.predictions[state.selectedStation] || Array(7).fill(0);
        }

        state.charts.forecast.data.datasets[0].data = forecastData;
        state.charts.forecast.update();
    }

    // Populate Patrol schedule
    function updatePatrolScheduler() {
        const tbody = document.getElementById('schedule-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const station = state.selectedStation;
        
        if (station === 'ALL') {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center" style="padding: 30px; color: var(--text-secondary);">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p style="font-weight: 600;">Patrol Scheduling requires a specific Police Station Division filter.</p>
                        <p style="font-size: 0.85em; margin-top: 4px;">Please select a jurisdiction dropdown options on the sidebar to compile local tactical patrol orders.</p>
                    </td>
                </tr>
            `;
            return;
        }

        // Get local junctions for this station
        const stationJunctions = state.junctions.filter(j => j.station === station);

        if (stationJunctions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center">No active patrol recommendations formulated for this station.</td></tr>`;
            return;
        }

        const scaleFactor = state.currentScaleFactor;

        // Map and calculate real-time PCII and priority
        const items = stationJunctions.map(j => {
            const currJ_pcii = (j.pcii / 3648.0) * scaleFactor;
            let priority = 'LOW';
            if (currJ_pcii >= 4.0) priority = 'CRITICAL';
            else if (currJ_pcii >= 2.0) priority = 'HIGH';
            else if (currJ_pcii >= 0.8) priority = 'MEDIUM';

            // Get action from primary violation
            let action = 'Routine Patrol';
            const viol = String(j.primary_violation).toUpperCase();
            if (viol.includes('DOUBLE')) action = 'Double Parking Towing Sweep';
            else if (viol.includes('MAIN ROAD')) action = 'Active Lane Clamping';
            else if (viol.includes('FOOTPATH')) action = 'Clear Footpath Obstructions';
            else if (viol.includes('NO PARKING')) action = 'Parking Enforcement & Fine';
            else if (viol.includes('WRONG')) action = 'Obstructive Vehicle Clamping';

            // Get assets from priority
            let assets = '1 Patrol Officer';
            if (priority === 'CRITICAL') assets = '2 Tow Trucks + 4 Officers';
            else if (priority === 'HIGH') assets = '1 Tow Truck + 2 Officers';
            else if (priority === 'MEDIUM') assets = '2 Clamping Officers';

            const impact = (currJ_pcii * 1.5).toFixed(1) + '% Delay Reduction';
            const endHour = (state.selectedHour + 1) % 24;
            const windowStr = `${String(state.selectedHour).padStart(2, '0')}:00 - ${String(endHour).padStart(2, '0')}:00`;

            return {
                priority: priority,
                location_name: j.name,
                location_type: 'Junction',
                peak_day: state.selectedDay,
                peak_window: windowStr,
                primary_vehicle: j.primary_vehicle,
                action: action,
                assets: assets,
                prevention_impact: impact,
                lat: j.lat,
                lng: j.lng,
                pcii_val: currJ_pcii
            };
        });

        // Sort by real-time pcii value descending
        items.sort((a, b) => b.pcii_val - a.pcii_val);

        items.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="priority-badge ${r.priority}">${r.priority}</span></td>
                <td>
                    <span class="zone-name">${r.location_name}</span>
                    <span class="zone-type">${r.location_type}</span>
                </td>
                <td><strong>${r.peak_day}</strong></td>
                <td class="patrol-window">${r.peak_window}</td>
                <td><span class="mono-text">${r.primary_vehicle}</span></td>
                <td class="action-detail">${r.action}</td>
                <td class="assets-detail">${r.assets}</td>
                <td class="impact-detail">${r.prevention_impact}</td>
            `;

            // Hover marker highlight behavior
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => {
                state.map.setView([r.lat, r.lng], 16);
                
                // Add temporary indicator ring
                const circle = L.circle([r.lat, r.lng], {
                    color: '#ff0844',
                    fillColor: 'transparent',
                    weight: 3,
                    radius: 70
                }).addTo(state.map);
                
                setTimeout(() => {
                    state.map.removeLayer(circle);
                }, 2000);
            });

            tbody.appendChild(tr);
        });
    }

    // Export patrol orders
    function exportPatrolSchedule() {
        const station = state.selectedStation;
        if (station === 'ALL') {
            alert('Please select a specific Police Station Jurisdiction first to export its patrol orders.');
            return;
        }

        const recs = state.recommendations[station];
        if (!recs || recs.length === 0) {
            alert('No patrol orders found to export.');
            return;
        }

        let docText = `============================================================\n`;
        docText += `BANGALORE TRAFFIC POLICE - TACTICAL ENFORCEMENT PATROL ORDER\n`;
        docText += `JURISDICTION: ${station.toUpperCase()} DIVISION\n`;
        docText += `COMPILED ON: ${new Date().toLocaleDateString()} (GRIDLOCK VISION AI ENGINE)\n`;
        docText += `============================================================\n\n`;

        recs.forEach((r, idx) => {
            docText += `ORDER #${idx + 1} - [PRIORITY: ${r.priority}]\n`;
            docText += `------------------------------------------------------------\n`;
            docText += `- Target Location  : ${r.location_name} (${r.location_type})\n`;
            docText += `- Patrol Day       : ${r.peak_day}\n`;
            docText += `- Active Time (IST): ${r.peak_window}\n`;
            docText += `- Busiest Vehicle  : ${r.primary_vehicle}\n`;
            docText += `- Enforcement Plan : ${r.action}\n`;
            docText += `- Tactical Assets  : ${r.assets}\n`;
            docText += `- Est. Traffic Prev: ${r.prevention_impact}\n\n`;
        });

        docText += `============================================================\n`;
        docText += `END OF ENFORCEMENT DIRECTIVE\n`;
        docText += `============================================================\n`;

        // Create a blob and download
        const blob = new Blob([docText], { type: 'text/plain' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Patrol_Order_${station.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.txt`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // ==========================================================================
    // Tab switching controller
    // ==========================================================================
    function initTabs() {
        document.querySelectorAll('.tab-link').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const targetTab = e.currentTarget.dataset.tab;
                
                // Switch Active Tab Link
                document.querySelectorAll('.tab-link').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                
                // Switch Active Tab View
                document.querySelectorAll('.tab-view').forEach(v => v.classList.remove('active'));
                const targetView = document.getElementById(`${targetTab}-view`);
                if (targetView) {
                    targetView.classList.add('active');
                }
                
                // Leaflet Map fix: trigger size recalculation when tab becomes visible
                if (targetTab === 'dashboard' && state.map) {
                    setTimeout(() => {
                        state.map.invalidateSize();
                    }, 100);
                }
            });
        });
    }

    // ==========================================================================
    // AI Agent Simulator Logic
    // ==========================================================================
    function initAIScanner() {
        const checkEl = document.getElementById('explorer-day-select');
        if (!checkEl) return; // Guard against AI scanner removal
        
        const scenarios = {
            clear: {
                name: "Toyota Innova Crysta",
                silhouette: "🚗",
                plate: "KA 51 MB 4321",
                location: "Safina Plaza Junction (BTP051)",
                obstruction: "Car parked on Main Road (blocking 40% lane width)",
                duration: "6 min 15 sec",
                logs: [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 15, text: "ANPR> License Plate Detected: [KA 51 MB 4321] (Confidence: 98%)", type: "success" },
                    { time: 22, text: "DATABASE-RTO> Querying owner registration registry... Match found: owner 'Rajesh Kumar'", type: "success" },
                    { time: 30, text: "CLASSIFIER> Vehicle classified: Passenger CAR (Toyota Innova)", type: "info" },
                    { time: 45, text: "GEOCONTEXT> Matching GPS coordinates with restricted areas...", type: "info" },
                    { time: 60, text: "GEOCONTEXT> Location verified: BTP051 Safina Plaza main corridor.", type: "success" },
                    { time: 80, text: "OBSTRUCTION-CALC> Lane boundaries occupied: 40% width displacement.", type: "danger" },
                    { time: 95, text: "TIMER> Tracking vehicle presence timeline... Dwell time: 2 min 00 sec.", type: "info" },
                    { time: 110, text: "DECISION-ENGINE> Vehicle hazard lights active? [NO]", type: "info" },
                    { time: 115, text: "DECISION-ENGINE> Target validated. Obstruction threshold exceeded.", type: "danger" },
                    { time: 120, text: "DISPATCHER> Challan receipt generated. Auto-dispatched directly to Rajesh Kumar.", type: "success" }
                ],
                result: {
                    type: "approved",
                    owner: "Rajesh Kumar",
                    fine: "₹1,000",
                    offence: "Obstructive Wrong Parking",
                    ticketId: "CH-2026-98124"
                }
            },
            muddy: {
                name: "Honda City",
                silhouette: "🚗",
                plate: "KA 03 ?? 99??",
                location: "KR Market Junction (BTP082)",
                obstruction: "Car parked on Main Road (blocking 35% lane width)",
                duration: "4 min 30 sec",
                logs: [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 20, text: "ANPR> OCR Failure: Plate obscured by mud/dirt (Read confidence: 34%)", type: "warning" },
                    { time: 25, text: "DATABASE-RTO> Querying owner registration registry... Failure: OCR confidence too low to query owner records.", type: "warning" },
                    { time: 35, text: "ANPR> Partial Plate locked: [KA 03 ?? 99??]", type: "warning" },
                    { time: 50, text: "CLASSIFIER> Vehicle classified: Passenger CAR (Honda City)", type: "info" },
                    { time: 65, text: "GEOCONTEXT> Location verified: BTP082 KR Market restricted zone.", type: "success" },
                    { time: 85, text: "OBSTRUCTION-CALC> Lane width occupied: 35% (Medium obstruction)", type: "danger" },
                    { time: 105, text: "TIMER> Stopped duration verified: 2 min 00 sec.", type: "danger" },
                    { time: 115, text: "DECISION-ENGINE> Plate mud cover blocks legal owner match.", type: "warning" },
                    { time: 120, text: "DECISION-ENGINE> Flagged as [UNSURE]. Sending to Human Review...", type: "warning" }
                ],
                result: {
                    type: "unsure",
                    reason: "License plate is covered in mud/dirt. Number plate recognition read confidence is too low (34%) to issue auto-challan.",
                    action: "Routed to Human Officer Queue. Desktop operator must manually inspect the photo evidence to identify plate characters."
                }
            },
            breakdown: {
                name: "Hyundai Creta",
                silhouette: "🚗",
                plate: "KA 04 MP 5566",
                location: "Elite Junction (BTP040)",
                obstruction: "Car parked next to yellow curb",
                duration: "8 min 12 sec",
                logs: [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 15, text: "ANPR> License Plate Detected: [KA 04 MP 5566] (Confidence: 97%)", type: "success" },
                    { time: 22, text: "DATABASE-RTO> Querying owner registration registry... Match found: owner 'Vikram Mehta'", type: "success" },
                    { time: 30, text: "CLASSIFIER> Vehicle classified: Passenger CAR (Hyundai Creta)", type: "info" },
                    { time: 45, text: "GEOCONTEXT> Location verified: BTP040 restricted corridor.", type: "success" },
                    { time: 65, text: "SAFETY-SCAN> Scanning vehicle safety indicators...", type: "info" },
                    { time: 75, text: "SAFETY-SCAN> Warning: Hazard warning lights active. Breakdown suspected.", type: "warning" },
                    { time: 95, text: "OBSTRUCTION-CALC> Lane width occupied: 15% (Low lane impact)", type: "info" },
                    { time: 110, text: "TIMER> Stopped duration verified: 2 min 00 sec.", type: "danger" },
                    { time: 120, text: "DECISION-ENGINE> Emergency hazard active. Flagging as [UNSURE]...", type: "warning" }
                ],
                result: {
                    type: "unsure",
                    reason: "The vehicle hazard/warning lights are blinking. This suggests a potential breakdown or emergency medical stop.",
                    action: "Routed to Human Officer Queue. The operator will verify if the vehicle is broken down before dismissing or approving the fine."
                }
            },
            stop: {
                name: "Maruti Swift",
                silhouette: "🚗",
                plate: "KA 02 MD 1111",
                location: "Hosahalli Metro Station (BTP020)",
                obstruction: "Car stopped briefly at curb side",
                duration: "15 seconds",
                logs: [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 15, text: "ANPR> License Plate Detected: [KA 02 MD 1111] (Confidence: 99%)", type: "success" },
                    { time: 22, text: "DATABASE-RTO> Querying owner registration registry... Match found: owner 'Priya Sharma'", type: "success" },
                    { time: 30, text: "CLASSIFIER> Vehicle classified: Passenger CAR (Maruti Swift)", type: "info" },
                    { time: 40, text: "GEOCONTEXT> Location verified: BTP020 metro drop-off corridor.", type: "info" },
                    { time: 50, text: "TIMER> Vehicle starting ignition. Leaving geofenced drop-off point.", type: "info" },
                    { time: 55, text: "TIMER> Dwell time calculated: 28 seconds (Threshold: 2 mins)", type: "success" },
                    { time: 80, text: "OBSTRUCTION-CALC> Lane occupancy: 0% (Vehicle left curb)", type: "success" },
                    { time: 100, text: "DECISION-ENGINE> Dwell time under threshold. No violation occurred.", type: "success" },
                    { time: 120, text: "BTP-AI-AGENT> Action Complete. Status: [NO VIOLATION - CLEAR]", type: "success" }
                ],
                result: {
                    type: "clear",
                    reason: "The vehicle stopped for only 28 seconds to drop off or pick up passengers, which is allowed in this geofenced zone.",
                    action: "No action taken. Roadway flow clearance approved."
                }
            }
        };

        let currentScenario = 'clear';
        let scanInProgress = false;
        let recordingInProgress = false;
        let mediaStream = null;
        let mediaRecorder = null;
        let recordedChunks = [];
        let recordedBlobUrl = null;
        let recordTimerInterval = null;
        let recordSeconds = 0;

        // Scenario Click Listeners
        document.querySelectorAll('.scenario-item').forEach(card => {
            card.addEventListener('click', (e) => {
                if (scanInProgress || recordingInProgress) return;
                
                document.querySelectorAll('.scenario-item').forEach(c => c.classList.remove('active'));
                const item = e.currentTarget;
                item.classList.add('active');
                
                currentScenario = item.dataset.scenario;
                
                if (currentScenario === 'live') {
                    // Update camera screen elements for live preview
                    document.getElementById('vehicle-silhouette-id').textContent = '📹';
                    document.getElementById('vehicle-plate-overlay-id').textContent = 'AWAITING RECORDING';
                    document.getElementById('cam-location').textContent = 'Source: Live Device Webcam';
                    
                    const camStatus = document.getElementById('cam-status');
                    camStatus.textContent = "LIVE RECORDER READY";
                    
                    const recIndicator = document.getElementById('cam-rec-indicator');
                    recIndicator.textContent = "STANDBY ⚪";
                    recIndicator.style.color = "#aaa";
                    
                    // Show video tag (empty stream for now)
                    document.getElementById('scanner-video-element').style.display = 'block';
                    document.getElementById('mock-vehicle-display').style.display = 'flex'; // Overlay text
                    
                    // Reset timeline
                    document.getElementById('timeline-current-time').textContent = '0:00';
                    document.getElementById('timeline-progress-bar').style.width = '0%';
                    
                    // Update Action Button
                    const btn = document.getElementById('btn-run-scan');
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    const scanBtnText = document.getElementById('btn-run-scan-text');
                    scanBtnText.textContent = "Start Live Video Record";
                    
                    // Reset terminal
                    const term = document.getElementById('terminal-logs');
                    term.innerHTML = `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Live camera interface initialized. Click "Start Live Video Record" to capture live footage.</div>`;
                    
                    // Reset challan
                    const container = document.getElementById('dispatch-result-container');
                    container.innerHTML = `
                        <div class="empty-dispatch-state">
                            <svg class="dispatch-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                <line x1="16" y1="2" x2="16" y2="6"/>
                                <line x1="8" y1="2" x2="8" y2="6"/>
                                <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            <p>Waiting for video frame telemetry...</p>
                        </div>
                    `;
                    return;
                }
                
                if (currentScenario === 'upload') {
                    return;
                }
                
                // Update camera screen overlay fields for standard files
                const sData = scenarios[currentScenario];
                document.getElementById('vehicle-silhouette-id').textContent = sData.silhouette;
                document.getElementById('vehicle-plate-overlay-id').textContent = sData.plate;
                document.getElementById('cam-location').textContent = `File: officer_recording_${currentScenario}.mp4 (${sData.location.split(' ')[0]})`;
                
                const camStatus = document.getElementById('cam-status');
                camStatus.textContent = "VIDEO INGESTION ACTIVE";
                
                const recIndicator = document.getElementById('cam-rec-indicator');
                recIndicator.textContent = "ANALYZING 🔴";
                recIndicator.style.color = "#ff3838";
                
                // Hide video, show silhouette for mock recordings
                document.getElementById('scanner-video-element').style.display = 'none';
                document.getElementById('mock-vehicle-display').style.display = 'flex';
                
                // Reset timeline
                document.getElementById('timeline-current-time').textContent = '0:00';
                document.getElementById('timeline-progress-bar').style.width = '0%';
                
                // Update Action Button
                const btn = document.getElementById('btn-run-scan');
                btn.disabled = false;
                btn.style.opacity = '1';
                const scanBtnText = document.getElementById('btn-run-scan-text');
                scanBtnText.textContent = "Scan Officer Video (2 min)";
                
                // Reset terminal
                const term = document.getElementById('terminal-logs');
                term.innerHTML = `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Camera feed loaded: [officer_recording_${currentScenario}.mp4]. Click "Scan Officer Video" to begin.</div>`;
                
                // Reset challan
                const container = document.getElementById('dispatch-result-container');
                container.innerHTML = `
                    <div class="empty-dispatch-state">
                        <svg class="dispatch-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                            <line x1="16" y1="2" x2="16" y2="6"/>
                            <line x1="8" y1="2" x2="8" y2="6"/>
                            <line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        <p>Waiting for video frame telemetry...</p>
                    </div>
                `;
            });
        });

        // Scan button click listener
        document.getElementById('btn-run-scan').addEventListener('click', () => {
            if (scanInProgress) return;
            
            if (currentScenario === 'live') {
                if (recordingInProgress) {
                    stopLiveRecording();
                } else {
                    startLiveRecording();
                }
            } else if (currentScenario === 'upload') {
                runUploadScanSimulation();
            } else {
                runScanSimulation();
            }
        });

        function startLiveRecording() {
            recordingInProgress = true;
            recordSeconds = 0;
            recordedChunks = [];
            
            if (recordedBlobUrl) {
                URL.revokeObjectURL(recordedBlobUrl);
                recordedBlobUrl = null;
            }
            
            const btnText = document.getElementById('btn-run-scan-text');
            btnText.textContent = "Stop & Run AI Ingestion";
            
            const camStatus = document.getElementById('cam-status');
            camStatus.textContent = "CAM RECORDING ACTIVE";
            
            const recIndicator = document.getElementById('cam-rec-indicator');
            recIndicator.textContent = "RECORDING 🔴";
            recIndicator.style.color = "#ff3838";
            
            const camScreen = document.getElementById('camera-screen-element');
            camScreen.classList.add('recording-active');
            
            const term = document.getElementById('terminal-logs');
            term.innerHTML = `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Requesting webcam access...</div>`;
            
            // Hide vehicle displays
            document.getElementById('mock-vehicle-display').style.display = 'none';
            
            navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
                .then(stream => {
                    mediaStream = stream;
                    const videoEl = document.getElementById('scanner-video-element');
                    videoEl.srcObject = stream;
                    videoEl.src = '';
                    videoEl.muted = true;
                    videoEl.style.display = 'block';
                    videoEl.play();
                    
                    term.innerHTML += `<div class="term-log-line term-success"><span class="term-prompt">BTP-AI-AGENT></span> Webcam stream acquired successfully.</div>`;
                    term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Live recording initiated. Capturing traffic feed.</div>`;
                    
                    // Setup MediaRecorder
                    let options = { mimeType: 'video/webm;codecs=vp9' };
                    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                        options = { mimeType: 'video/webm' };
                    }
                    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                        options = { mimeType: 'video/mp4' };
                    }
                    
                    try {
                        mediaRecorder = new MediaRecorder(stream, options);
                    } catch (e) {
                        mediaRecorder = new MediaRecorder(stream);
                    }
                    
                    mediaRecorder.ondataavailable = (event) => {
                        if (event.data && event.data.size > 0) {
                            recordedChunks.push(event.data);
                        }
                    };
                    
                    mediaRecorder.onstop = () => {
                        const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
                        recordedBlobUrl = URL.createObjectURL(blob);
                        
                        // Switch video element source to the blob
                        videoEl.srcObject = null;
                        videoEl.src = recordedBlobUrl;
                        videoEl.loop = true;
                        videoEl.play();
                        
                        // Start analysis simulation
                        runLiveScanSimulation();
                    };
                    
                    mediaRecorder.start(100); // chunk every 100ms
                    
                    // Start timer ticking (real time)
                    startRecordTimer();
                })
                .catch(err => {
                    console.error("Camera access error:", err);
                    term.innerHTML += `<div class="term-log-line term-warning"><span class="term-prompt">BTP-AI-AGENT></span> WARNING: Webcam access denied/failed. Falling back to simulated live feed.</div>`;
                    mediaStream = null;
                    mediaRecorder = null;
                    
                    // Simulation mode fallback:
                    // Hide video, show silhouette or mock scanner display
                    const videoEl = document.getElementById('scanner-video-element');
                    videoEl.style.display = 'none';
                    const mockDisplay = document.getElementById('mock-vehicle-display');
                    mockDisplay.style.display = 'flex';
                    document.getElementById('vehicle-silhouette-id').textContent = '📸';
                    document.getElementById('vehicle-plate-overlay-id').textContent = 'SIMULATING LIVE FEED';
                    
                    startRecordTimer();
                });
        }

        function startRecordTimer() {
            const currentTimeEl = document.getElementById('timeline-current-time');
            const progressBar = document.getElementById('timeline-progress-bar');
            
            recordTimerInterval = setInterval(() => {
                recordSeconds += 1;
                
                const m = Math.floor(recordSeconds / 60);
                const s = recordSeconds % 60;
                currentTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                
                const pct = (recordSeconds / 120) * 100;
                progressBar.style.width = `${pct}%`;
                
                // Add logs periodically to show active recording status
                const term = document.getElementById('terminal-logs');
                if (recordSeconds === 5) {
                    term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> [0:05] ANPR> Frame buffer scanning active. Calibrating camera grid boundaries...</div>`;
                } else if (recordSeconds === 12) {
                    term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> [0:12] CLASSIFIER> Capturing road lane occupancy index...</div>`;
                } else if (recordSeconds === 25) {
                    term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> [0:25] TIMER> Vehicle dwelling duration check tick (25s elapsed).</div>`;
                } else if (recordSeconds === 45) {
                    term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> [0:45] ANPR> OCR scanner locked on license plate candidate region...</div>`;
                }
                term.scrollTop = term.scrollHeight;
                
                if (recordSeconds >= 120) {
                    stopLiveRecording();
                }
            }, 1000); // 1 second real-time
        }

        function stopLiveRecording() {
            clearInterval(recordTimerInterval);
            recordingInProgress = false;
            
            const btn = document.getElementById('btn-run-scan');
            btn.disabled = true;
            btn.style.opacity = '0.5';
            
            const camScreen = document.getElementById('camera-screen-element');
            camScreen.classList.remove('recording-active');
            
            const camStatus = document.getElementById('cam-status');
            camStatus.textContent = "PROCESSING VIDEO STREAM";
            
            const recIndicator = document.getElementById('cam-rec-indicator');
            recIndicator.textContent = "ANALYZING 🔴";
            recIndicator.style.color = "#ff3838";
            
            const term = document.getElementById('terminal-logs');
            term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Live recording stopped (Duration: ${recordSeconds}s). Shutting down webcam stream...</div>`;
            
            // Stop media tracks
            if (mediaStream) {
                mediaStream.getTracks().forEach(track => track.stop());
            }
            
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            } else {
                // If fallback mode (no camera), directly trigger the simulation after a small delay
                setTimeout(() => {
                    runLiveScanSimulation();
                }, 1000);
            }
        }

        function runLiveScanSimulation() {
            scanInProgress = true;
            
            const btn = document.getElementById('btn-run-scan');
            btn.disabled = true;
            btn.style.opacity = '0.5';
            const btnText = document.getElementById('btn-run-scan-text');
            btnText.textContent = "Analyzing Live Capture...";
            
            const laser = document.getElementById('scan-laser-line');
            laser.classList.add('scanning');
            
            const term = document.getElementById('terminal-logs');
            term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Compiling and loading video capture buffer.</div>`;
            term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Initiating neural network video ingestion pipeline...</div>`;
            
            // Generate a random outcome
            const outcomes = ['approved', 'muddy', 'breakdown', 'clear'];
            const chosenOutcome = outcomes[Math.floor(Math.random() * outcomes.length)];
            
            const randomPlateNum = Math.floor(1000 + Math.random() * 9000);
            const randomLetters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
            
            let simulatedPlate = "";
            let simulatedVehicle = "";
            let simulatedOwner = "";
            let simulatedLogs = [];
            let simulatedResult = {};
            let simulatedLocation = "Bannerghatta Rd Corridor (BTP115)";
            let simulatedSilhouette = "🚗";
            
            if (chosenOutcome === 'approved') {
                simulatedPlate = `KA 51 ${randomLetters} ${randomPlateNum}`;
                simulatedVehicle = "Toyota Fortuner (Black)";
                simulatedOwner = ["Ramesh Gowda", "Arun Murthy", "Sunita Rao", "Karthik N"][Math.floor(Math.random() * 4)];
                simulatedLogs = [
                    { time: 5, text: "ANPR> Reading license plate frames from live stream...", type: "info" },
                    { time: 18, text: `ANPR> License Plate Detected: [${simulatedPlate}] (Confidence: 99.2%)`, type: "success" },
                    { time: 25, text: `DATABASE-RTO> Querying owner registration registry... Match found: owner '${simulatedOwner}'`, type: "success" },
                    { time: 30, text: `CLASSIFIER> Vehicle classified: SUV (${simulatedVehicle})`, type: "info" },
                    { time: 45, text: "GEOCONTEXT> Matching GPS coordinates with restricted areas...", type: "info" },
                    { time: 60, text: "GEOCONTEXT> Target verified: BTP115 restricted double-yellow boundary.", type: "success" },
                    { time: 80, text: "OBSTRUCTION-CALC> Lane boundaries occupied: 45% width displacement.", type: "danger" },
                    { time: 95, text: "TIMER> Tracking vehicle presence timeline... Dwell time: 2 min 14 sec.", type: "info" },
                    { time: 110, text: "DECISION-ENGINE> Vehicle hazard lights active? [NO]", type: "info" },
                    { time: 115, text: "DECISION-ENGINE> Target validated. Obstruction threshold exceeded.", type: "danger" },
                    { time: 120, text: `DISPATCHER> Challan receipt generated. Auto-dispatched directly to ${simulatedOwner} via SMS link.`, type: "success" }
                ];
                simulatedResult = {
                    type: "approved",
                    owner: simulatedOwner,
                    fine: "₹1,000",
                    offence: "Obstructive No-Parking Zone Violation",
                    ticketId: `CH-2026-${Math.floor(10000 + Math.random()*90000)}`
                };
            } else if (chosenOutcome === 'muddy') {
                simulatedPlate = `KA 03 ?? ${randomPlateNum}`;
                simulatedVehicle = "Mahindra Thar";
                simulatedSilhouette = "🚙";
                simulatedLogs = [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 20, text: "ANPR> OCR Failure: Plate heavily obscured by mud (Read confidence: 28%)", type: "warning" },
                    { time: 25, text: "DATABASE-RTO> Querying owner registration registry... Failure: OCR confidence too low to query owner records.", type: "warning" },
                    { time: 35, text: `ANPR> Partial Plate locked: [${simulatedPlate}]`, type: "warning" },
                    { time: 50, text: `CLASSIFIER> Vehicle classified: SUV (${simulatedVehicle})`, type: "info" },
                    { time: 65, text: "GEOCONTEXT> Location verified: BTP115 Bannerghatta corridor.", type: "success" },
                    { time: 85, text: "OBSTRUCTION-CALC> Lane width occupied: 38% (Medium obstruction)", type: "danger" },
                    { time: 105, text: "TIMER> Stopped duration verified: 2 min 05 sec.", type: "danger" },
                    { time: 115, text: "DECISION-ENGINE> Plate mud cover blocks legal owner match.", type: "warning" },
                    { time: 120, text: "DECISION-ENGINE> Flagged as [UNSURE]. Sending to Human Review...", type: "warning" }
                ];
                simulatedResult = {
                    type: "unsure",
                    reason: "License plate is covered in mud/dirt. Number plate recognition read confidence is too low (28%) to issue auto-challan.",
                    action: "Routed to Human Officer Queue. Desktop operator must manually inspect the video capture to identify plate characters."
                };
            } else if (chosenOutcome === 'breakdown') {
                simulatedPlate = `KA 04 ${randomLetters} 2288`;
                simulatedVehicle = "Tata Nexon";
                simulatedLogs = [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 15, text: `ANPR> License Plate Detected: [${simulatedPlate}] (Confidence: 96%)`, type: "success" },
                    { time: 22, text: "DATABASE-RTO> Querying owner registration registry... Match found: owner 'Anil Kumble'", type: "success" },
                    { time: 30, text: `CLASSIFIER> Vehicle classified: Passenger CAR (${simulatedVehicle})`, type: "info" },
                    { time: 45, text: "GEOCONTEXT> Location verified: BTP115 restricted corridor.", type: "success" },
                    { time: 65, text: "SAFETY-SCAN> Scanning vehicle safety indicators...", type: "info" },
                    { time: 75, text: "SAFETY-SCAN> Warning: Hazard warning lights active. Breakdown suspected.", type: "warning" },
                    { time: 95, text: "OBSTRUCTION-CALC> Lane width occupied: 15% (Low lane impact)", type: "info" },
                    { time: 110, text: "TIMER> Stopped duration verified: 2 min 00 sec.", type: "danger" },
                    { time: 120, text: "DECISION-ENGINE> Emergency hazard active. Flagging as [UNSURE]...", type: "warning" }
                ];
                simulatedResult = {
                    type: "unsure",
                    reason: "The vehicle hazard/warning lights are blinking. This suggests a potential breakdown or emergency medical stop.",
                    action: "Routed to Human Officer Queue. The operator will verify if the vehicle is broken down before dismissing or approving the fine."
                };
            } else {
                simulatedPlate = `KA 02 ${randomLetters} 9090`;
                simulatedVehicle = "Honda Activa";
                simulatedSilhouette = "🛵";
                simulatedLogs = [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 15, text: `ANPR> License Plate Detected: [${simulatedPlate}] (Confidence: 98%)`, type: "success" },
                    { time: 22, text: "DATABASE-RTO> Querying owner registration registry... Match found: owner 'Mohammad Siraj'", type: "success" },
                    { time: 30, text: `CLASSIFIER> Vehicle classified: Two-Wheeler (${simulatedVehicle})`, type: "info" },
                    { time: 40, text: "GEOCONTEXT> Location verified: BTP115 drop-off corridor.", type: "info" },
                    { time: 50, text: "TIMER> Vehicle starting ignition. Leaving geofenced drop-off point.", type: "info" },
                    { time: 55, text: "TIMER> Dwell time calculated: 22 seconds (Threshold: 2 mins)", type: "success" },
                    { time: 80, text: "OBSTRUCTION-CALC> Lane occupancy: 0% (Vehicle left curb)", type: "success" },
                    { time: 100, text: "DECISION-ENGINE> Dwell time under threshold. No violation occurred.", type: "success" },
                    { time: 120, text: "BTP-AI-AGENT> Action Complete. Status: [NO VIOLATION - CLEAR]", type: "success" }
                ];
                simulatedResult = {
                    type: "clear",
                    reason: "The vehicle stopped for only 22 seconds to drop off or pick up passengers, which is allowed in this geofenced zone.",
                    action: "No action taken. Roadway flow clearance approved."
                };
            }
            
            // If fallback simulation is active (no camera), update silhouette & plate on overlay
            if (!mediaStream) {
                document.getElementById('mock-vehicle-display').style.display = 'flex';
                document.getElementById('vehicle-silhouette-id').textContent = simulatedSilhouette;
                document.getElementById('vehicle-plate-overlay-id').textContent = simulatedPlate;
            }
            
            // Timeline elements
            const currentTimeEl = document.getElementById('timeline-current-time');
            const progressBar = document.getElementById('timeline-progress-bar');
            
            let simulatedSeconds = 0;
            const totalDuration = 120;
            const tickRate = 80; // Total duration 9.6s
            
            const printedLogs = new Set();
            
            const timer = setInterval(() => {
                simulatedSeconds += 1;
                
                const m = Math.floor(simulatedSeconds / 60);
                const s = simulatedSeconds % 60;
                currentTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                
                const pct = (simulatedSeconds / totalDuration) * 100;
                progressBar.style.width = `${pct}%`;
                
                simulatedLogs.forEach((log, index) => {
                    if (log.time <= simulatedSeconds && !printedLogs.has(index)) {
                        printedLogs.add(index);
                        
                        let logClass = '';
                        if (log.type === 'success') logClass = 'term-success';
                        else if (log.type === 'warning') logClass = 'term-warning';
                        else if (log.type === 'danger') logClass = 'term-danger';
                        
                        const textWithTime = `[${m}:${s.toString().padStart(2, '0')}] ${log.text}`;
                        const div = document.createElement('div');
                        div.className = 'term-log-line';
                        div.innerHTML = `<span class="term-prompt">BTP-AI-AGENT></span> <span class="${logClass}">${textWithTime}</span>`;
                        
                        term.appendChild(div);
                        term.scrollTop = term.scrollHeight;
                    }
                });
                
                if (simulatedSeconds >= totalDuration) {
                    clearInterval(timer);
                    scanInProgress = false;
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btnText.textContent = "Start Live Video Record";
                    laser.classList.remove('scanning');
                    
                    const camStatus = document.getElementById('cam-status');
                    camStatus.textContent = "VIDEO INGESTION ACTIVE";
                    
                    const recIndicator = document.getElementById('cam-rec-indicator');
                    recIndicator.textContent = "STANDBY ⚪";
                    recIndicator.style.color = "#aaa";
                    
                    // Render outcome details card
                    renderLiveScanResult(simulatedPlate, simulatedOwner, simulatedResult, simulatedLocation);
                }
            }, tickRate);
        }

        function renderLiveScanResult(plate, owner, res, location) {
            const container = document.getElementById('dispatch-result-container');
            container.innerHTML = '';
            
            if (res.type === 'approved') {
                container.innerHTML = `
                    <div class="challan-receipt">
                        <div class="receipt-header">
                            <h4>BANGALORE TRAFFIC POLICE</h4>
                            <p>AUTO-CHALLAN DISPATCH</p>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">TICKET ID:</span>
                            <span class="receipt-value">${res.ticketId}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">PLATE:</span>
                            <span class="receipt-value">${plate}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">OWNER:</span>
                            <span class="receipt-value">${owner}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">LOCATION:</span>
                            <span class="receipt-value" style="font-size:0.8em; text-align:right;">${location.split(' ')[0]}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">DURATION:</span>
                            <span class="receipt-value">2 min 14 sec</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">OFFENCE:</span>
                            <span class="receipt-value" style="font-size:0.85em; text-align:right;">${res.offence}</span>
                        </div>
                        <div class="receipt-total">
                            <span>FINE AMOUNT:</span>
                            <span>${res.fine}</span>
                        </div>
                        <div class="receipt-barcode">||||| | | |||| | |||</div>
                    </div>
                `;
            } else if (res.type === 'unsure') {
                container.innerHTML = `
                    <div class="warning-box">
                        <svg class="warning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <h4>FLAGGED AS UNSURE</h4>
                        <p style="font-size: 0.8em; margin: 4px 0;"><strong>Reason:</strong> ${res.reason}</p>
                        <p style="font-size: 0.75em; color: var(--text-muted); border-top: 1px solid rgba(255,159,67,0.15); padding-top:6px;">${res.action}</p>
                    </div>
                `;
            } else if (res.type === 'clear') {
                container.innerHTML = `
                    <div class="success-box">
                        <svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <h4>NO VIOLATION DETECTED</h4>
                        <p style="font-size: 0.8em; margin: 4px 0;">${res.reason}</p>
                        <p style="font-size: 0.75em; color: var(--text-muted); border-top: 1px solid rgba(16,172,132,0.15); padding-top:6px;">${res.action}</p>
                    </div>
                `;
            }
        }

        function runScanSimulation() {
            scanInProgress = true;
            
            const btn = document.getElementById('btn-run-scan');
            btn.disabled = true;
            btn.style.opacity = '0.5';
            
            const laser = document.getElementById('scan-laser-line');
            laser.classList.add('scanning');
            
            const term = document.getElementById('terminal-logs');
            term.innerHTML = `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Initiating 2-minute video file audit...</div>`;
            
            const sData = scenarios[currentScenario];
            const logsList = sData.logs;
            
            // Timeline elements
            const currentTimeEl = document.getElementById('timeline-current-time');
            const progressBar = document.getElementById('timeline-progress-bar');
            
            let simulatedSeconds = 0;
            const totalDuration = 120; // 2 minutes
            const tickRate = 80; // 80ms per tick. 120 ticks = 9.6 seconds total.
            
            // Keep track of logs printed to avoid duplicates
            const printedLogs = new Set();
            
            const timer = setInterval(() => {
                simulatedSeconds += 1;
                
                // Update timeline text
                const m = Math.floor(simulatedSeconds / 60);
                const s = simulatedSeconds % 60;
                currentTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                
                // Update progress bar width
                const pct = (simulatedSeconds / totalDuration) * 100;
                progressBar.style.width = `${pct}%`;
                
                // Print logs that correspond to this timestamp
                logsList.forEach((log, index) => {
                    if (log.time <= simulatedSeconds && !printedLogs.has(index)) {
                        printedLogs.add(index);
                        
                        let logClass = '';
                        if (log.type === 'success') logClass = 'term-success';
                        else if (log.type === 'warning') logClass = 'term-warning';
                        else if (log.type === 'danger') logClass = 'term-danger';
                        
                        const textWithTime = `[${m}:${s.toString().padStart(2, '0')}] ${log.text}`;
                        const div = document.createElement('div');
                        div.className = 'term-log-line';
                        div.innerHTML = `<span class="term-prompt">BTP-AI-AGENT></span> <span class="${logClass}">${textWithTime}</span>`;
                        
                        term.appendChild(div);
                        term.scrollTop = term.scrollHeight;
                    }
                });
                
                if (simulatedSeconds >= totalDuration) {
                    clearInterval(timer);
                    scanInProgress = false;
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    laser.classList.remove('scanning');
                    
                    // Render outcome details card
                    renderScanResult();
                }
            }, tickRate);
        }

        function renderScanResult() {
            const container = document.getElementById('dispatch-result-container');
            const sData = scenarios[currentScenario];
            const res = sData.result;
            
            container.innerHTML = '';
            
            if (res.type === 'approved') {
                container.innerHTML = `
                    <div class="challan-receipt">
                        <div class="receipt-header">
                            <h4>BANGALORE TRAFFIC POLICE</h4>
                            <p>AUTO-CHALLAN DISPATCH</p>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">TICKET ID:</span>
                            <span class="receipt-value">${res.ticketId}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">PLATE:</span>
                            <span class="receipt-value">${sData.plate}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">OWNER:</span>
                            <span class="receipt-value">${res.owner}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">LOCATION:</span>
                            <span class="receipt-value" style="font-size:0.8em; text-align:right;">${sData.location.split(' ')[0]}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">DURATION:</span>
                            <span class="receipt-value">${sData.duration}</span>
                        </div>
                        <div class="receipt-row">
                            <span class="receipt-label">OFFENCE:</span>
                            <span class="receipt-value" style="font-size:0.85em; text-align:right;">${res.offence}</span>
                        </div>
                        <div class="receipt-total">
                            <span>FINE AMOUNT:</span>
                            <span>${res.fine}</span>
                        </div>
                        <div class="receipt-barcode">||||| | | |||| | |||</div>
                    </div>
                `;
            } else if (res.type === 'unsure') {
                container.innerHTML = `
                    <div class="warning-box">
                        <svg class="warning-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <h4>FLAGGED AS UNSURE</h4>
                        <p style="font-size: 0.8em; margin: 4px 0;"><strong>Reason:</strong> ${res.reason}</p>
                        <p style="font-size: 0.75em; color: var(--text-muted); border-top: 1px solid rgba(255,159,67,0.15); padding-top:6px;">${res.action}</p>
                    </div>
                `;
            } else if (res.type === 'clear') {
                container.innerHTML = `
                    <div class="success-box">
                        <svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <h4>NO VIOLATION DETECTED</h4>
                        <p style="font-size: 0.8em; margin: 4px 0;">${res.reason}</p>
                        <p style="font-size: 0.75em; color: var(--text-muted); border-top: 1px solid rgba(16,172,132,0.15); padding-top:6px;">${res.action}</p>
                    </div>
                `;
            }
        }

        // Prevent event bubbling on file input click (avoids infinite recursion loop in card click listener)
        const fileInput = document.getElementById('video-file-input');
        if (fileInput) {
            fileInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        // File upload change listener
        document.getElementById('video-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            // Clean up old Blob URL if any
            if (recordedBlobUrl) {
                URL.revokeObjectURL(recordedBlobUrl);
                recordedBlobUrl = null;
            }
            
            // Generate a Blob URL for the uploaded video file
            const blobUrl = URL.createObjectURL(file);
            recordedBlobUrl = blobUrl;
            
            // Show video element and set source
            const videoEl = document.getElementById('scanner-video-element');
            videoEl.srcObject = null;
            videoEl.src = blobUrl;
            videoEl.loop = true;
            videoEl.muted = true;
            videoEl.style.display = 'block';
            videoEl.play();
            
            // Hide mock vehicle display since user's own video is shown
            document.getElementById('mock-vehicle-display').style.display = 'none';
            
            // Update camera screen overlay text
            document.getElementById('cam-location').textContent = `File: ${file.name} (Custom Upload)`;
            
            const camStatus = document.getElementById('cam-status');
            camStatus.textContent = "CUSTOM VIDEO UPLOADED";
            
            const recIndicator = document.getElementById('cam-rec-indicator');
            recIndicator.textContent = "STANDBY ⚪";
            recIndicator.style.color = "#aaa";
            
            // Reset timeline
            document.getElementById('timeline-current-time').textContent = '0:00';
            document.getElementById('timeline-progress-bar').style.width = '0%';
            
            // Update Action Button
            const btn = document.getElementById('btn-run-scan');
            btn.disabled = false;
            btn.style.opacity = '1';
            const scanBtnText = document.getElementById('btn-run-scan-text');
            scanBtnText.textContent = "Scan Uploaded Video";
            
            // Update terminal logs
            const term = document.getElementById('terminal-logs');
            term.innerHTML = `<div class="term-log-line term-success"><span class="term-prompt">BTP-AI-AGENT></span> Custom video file loaded: [${file.name}]. Click "Scan Uploaded Video" to start AI parsing.</div>`;
            
            // Reset challan dispatch view
            const container = document.getElementById('dispatch-result-container');
            container.innerHTML = `
                <div class="empty-dispatch-state">
                    <svg class="dispatch-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <p>Waiting for video frame telemetry...</p>
                </div>
            `;
        });

        function runUploadScanSimulation() {
            scanInProgress = true;
            
            const btn = document.getElementById('btn-run-scan');
            btn.disabled = true;
            btn.style.opacity = '0.5';
            const btnText = document.getElementById('btn-run-scan-text');
            btnText.textContent = "Analyzing Custom Video...";
            
            const laser = document.getElementById('scan-laser-line');
            laser.classList.add('scanning');
            
            const term = document.getElementById('terminal-logs');
            term.innerHTML = `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Parsing custom uploaded video file...</div>`;
            term.innerHTML += `<div class="term-log-line"><span class="term-prompt">BTP-AI-AGENT></span> Running AI plate detection and RTO query pipeline...</div>`;
            
            // Generate a random outcome
            const outcomes = ['approved', 'muddy', 'breakdown', 'clear'];
            const chosenOutcome = outcomes[Math.floor(Math.random() * outcomes.length)];
            
            const randomPlateNum = Math.floor(1000 + Math.random() * 9000);
            const randomLetters = String.fromCharCode(65 + Math.floor(Math.random() * 26)) + String.fromCharCode(65 + Math.floor(Math.random() * 26));
            
            let simulatedPlate = "";
            let simulatedVehicle = "";
            let simulatedOwner = "";
            let simulatedLogs = [];
            let simulatedResult = {};
            let simulatedLocation = "Safina Plaza (BTP051)";
            let simulatedSilhouette = "🚗";
            
            if (chosenOutcome === 'approved') {
                simulatedPlate = `KA 51 ${randomLetters} ${randomPlateNum}`;
                simulatedVehicle = "Toyota Fortuner (Black)";
                simulatedOwner = ["Ramesh Gowda", "Arun Murthy", "Sunita Rao", "Karthik N"][Math.floor(Math.random() * 4)];
                simulatedLogs = [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 18, text: `ANPR> License Plate Detected: [${simulatedPlate}] (Confidence: 99.1%)`, type: "success" },
                    { time: 25, text: `DATABASE-RTO> Querying owner registration registry... Match found: owner '${simulatedOwner}'`, type: "success" },
                    { time: 30, text: `CLASSIFIER> Vehicle classified: SUV (${simulatedVehicle})`, type: "info" },
                    { time: 45, text: "GEOCONTEXT> Matching GPS coordinates with restricted areas...", type: "info" },
                    { time: 60, text: "GEOCONTEXT> Target verified: BTP051 Safina Plaza double-yellow corridor.", type: "success" },
                    { time: 80, text: "OBSTRUCTION-CALC> Lane boundaries occupied: 45% width displacement.", type: "danger" },
                    { time: 95, text: "TIMER> Tracking vehicle presence timeline... Dwell time: 2 min 14 sec.", type: "info" },
                    { time: 110, text: "DECISION-ENGINE> Vehicle hazard lights active? [NO]", type: "info" },
                    { time: 115, text: "DECISION-ENGINE> Target validated. Obstruction threshold exceeded.", type: "danger" },
                    { time: 120, text: `DISPATCHER> Challan receipt generated. Auto-dispatched directly to ${simulatedOwner} via SMS link.`, type: "success" }
                ];
                simulatedResult = {
                    type: "approved",
                    owner: simulatedOwner,
                    fine: "₹1,000",
                    offence: "Obstructive No-Parking Zone Violation",
                    ticketId: `CH-2026-${Math.floor(10000 + Math.random()*90000)}`
                };
            } else if (chosenOutcome === 'muddy') {
                simulatedPlate = `KA 03 ?? ${randomPlateNum}`;
                simulatedVehicle = "Mahindra Thar";
                simulatedSilhouette = "🚙";
                simulatedLogs = [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 20, text: "ANPR> OCR Failure: Plate heavily obscured by mud (Read confidence: 28%)", type: "warning" },
                    { time: 25, text: "DATABASE-RTO> Querying owner registration registry... Failure: OCR confidence too low to query owner records.", type: "warning" },
                    { time: 35, text: `ANPR> Partial Plate locked: [${simulatedPlate}]`, type: "warning" },
                    { time: 50, text: `CLASSIFIER> Vehicle classified: SUV (${simulatedVehicle})`, type: "info" },
                    { time: 65, text: "GEOCONTEXT> Location verified: BTP051 corridor.", type: "success" },
                    { time: 85, text: "OBSTRUCTION-CALC> Lane width occupied: 38% (Medium obstruction)", type: "danger" },
                    { time: 105, text: "TIMER> Stopped duration verified: 2 min 05 sec.", type: "danger" },
                    { time: 115, text: "DECISION-ENGINE> Plate mud cover blocks legal owner match.", type: "warning" },
                    { time: 120, text: "DECISION-ENGINE> Flagged as [UNSURE]. Sending to Human Review...", type: "warning" }
                ];
                simulatedResult = {
                    type: "unsure",
                    reason: "License plate is covered in mud/dirt. Number plate recognition read confidence is too low (28%) to issue auto-challan.",
                    action: "Routed to Human Officer Queue. Desktop operator must manually inspect the video capture to identify plate characters."
                };
            } else if (chosenOutcome === 'breakdown') {
                simulatedPlate = `KA 04 ${randomLetters} 2288`;
                simulatedVehicle = "Tata Nexon";
                simulatedLogs = [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 15, text: `ANPR> License Plate Detected: [${simulatedPlate}] (Confidence: 96%)`, type: "success" },
                    { time: 22, text: "DATABASE-RTO> Querying owner registration registry... Match found: owner 'Anil Kumble'", type: "success" },
                    { time: 30, text: `CLASSIFIER> Vehicle classified: Passenger CAR (${simulatedVehicle})`, type: "info" },
                    { time: 45, text: "GEOCONTEXT> Location verified: BTP051 corridor.", type: "success" },
                    { time: 65, text: "SAFETY-SCAN> Scanning vehicle safety indicators...", type: "info" },
                    { time: 75, text: "SAFETY-SCAN> Warning: Hazard warning lights active. Breakdown suspected.", type: "warning" },
                    { time: 95, text: "OBSTRUCTION-CALC> Lane width occupied: 15% (Low lane impact)", type: "info" },
                    { time: 110, text: "TIMER> Stopped duration verified: 2 min 00 sec.", type: "danger" },
                    { time: 120, text: "DECISION-ENGINE> Emergency hazard active. Flagging as [UNSURE]...", type: "warning" }
                ];
                simulatedResult = {
                    type: "unsure",
                    reason: "The vehicle hazard/warning lights are blinking. This suggests a potential breakdown or emergency medical stop.",
                    action: "Routed to Human Officer Queue. The operator will verify if the vehicle is broken down before dismissing or approving the fine."
                };
            } else {
                simulatedPlate = `KA 02 ${randomLetters} 9090`;
                simulatedVehicle = "Honda Activa";
                simulatedSilhouette = "🛵";
                simulatedLogs = [
                    { time: 5, text: "ANPR> Ingesting video frames for plate scanning...", type: "info" },
                    { time: 15, text: `ANPR> License Plate Detected: [${simulatedPlate}] (Confidence: 98%)`, type: "success" },
                    { time: 22, text: "DATABASE-RTO> Querying owner registration registry... Match found: owner 'Mohammad Siraj'", type: "success" },
                    { time: 30, text: `CLASSIFIER> Two-Wheeler (${simulatedVehicle})`, type: "info" },
                    { time: 40, text: "GEOCONTEXT> Location verified: BTP051 corridor.", type: "info" },
                    { time: 50, text: "TIMER> Vehicle starting ignition. Leaving geofenced drop-off point.", type: "info" },
                    { time: 55, text: "TIMER> Dwell time calculated: 22 seconds (Threshold: 2 mins)", type: "success" },
                    { time: 80, text: "OBSTRUCTION-CALC> Lane occupancy: 0% (Vehicle left curb)", type: "success" },
                    { time: 100, text: "DECISION-ENGINE> Dwell time under threshold. No violation occurred.", type: "success" },
                    { time: 120, text: "BTP-AI-AGENT> Action Complete. Status: [NO VIOLATION - CLEAR]", type: "success" }
                ];
                simulatedResult = {
                    type: "clear",
                    reason: "The vehicle stopped for only 22 seconds to drop off or pick up passengers, which is allowed in this geofenced zone.",
                    action: "No action taken. Roadway flow clearance approved."
                };
            }
            
            // Timeline elements
            const currentTimeEl = document.getElementById('timeline-current-time');
            const progressBar = document.getElementById('timeline-progress-bar');
            
            let simulatedSeconds = 0;
            const totalDuration = 120;
            const tickRate = 80;
            
            const printedLogs = new Set();
            
            const timer = setInterval(() => {
                simulatedSeconds += 1;
                
                const m = Math.floor(simulatedSeconds / 60);
                const s = simulatedSeconds % 60;
                currentTimeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
                
                const pct = (simulatedSeconds / totalDuration) * 100;
                progressBar.style.width = `${pct}%`;
                
                simulatedLogs.forEach((log, index) => {
                    if (log.time <= simulatedSeconds && !printedLogs.has(index)) {
                        printedLogs.add(index);
                        
                        let logClass = '';
                        if (log.type === 'success') logClass = 'term-success';
                        else if (log.type === 'warning') logClass = 'term-warning';
                        else if (log.type === 'danger') logClass = 'term-danger';
                        
                        const textWithTime = `[${m}:${s.toString().padStart(2, '0')}] ${log.text}`;
                        const div = document.createElement('div');
                        div.className = 'term-log-line';
                        div.innerHTML = `<span class="term-prompt">BTP-AI-AGENT></span> <span class="${logClass}">${textWithTime}</span>`;
                        
                        term.appendChild(div);
                        term.scrollTop = term.scrollHeight;
                    }
                });
                
                if (simulatedSeconds >= totalDuration) {
                    clearInterval(timer);
                    scanInProgress = false;
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btnText.textContent = "Scan Uploaded Video";
                    laser.classList.remove('scanning');
                    
                    const camStatus = document.getElementById('cam-status');
                    camStatus.textContent = "VIDEO INGESTION ACTIVE";
                    
                    const recIndicator = document.getElementById('cam-rec-indicator');
                    recIndicator.textContent = "STANDBY ⚪";
                    recIndicator.style.color = "#aaa";
                    
                    // Render outcome details card
                    renderLiveScanResult(simulatedPlate, simulatedOwner, simulatedResult, simulatedLocation);
                }
            }, tickRate);
        }
    }

    // Start App Ingestion
    loadData();
    initTabs();
    initAIScanner();
});
