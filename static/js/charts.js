var riskChart = null;
var featureChart = null;

function drawRiskPie(counts) {
    var ctx = document.getElementById('riskPieChart').getContext('2d');

    if (riskChart) riskChart.destroy();

    riskChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Safe', 'At Risk', 'Danger'],
            datasets: [{
                data: [counts['Safe'], counts['At Risk'], counts['Danger']],
                backgroundColor: ['#16a34a', '#d97706', '#dc2626'],
                borderColor: '#fff',
                borderWidth: 3
            }]
        },
        options: {
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { padding: 16, font: { size: 12 } }
                }
            }
        }
    });
}

function drawFeatureBar(importances) {
    var ctx = document.getElementById('featureBarChart').getContext('2d');
    if (featureChart) featureChart.destroy();

    var names = {
        attendance: 'Attendance',
        marks: 'Marks',
        study_hours: 'Study Hours',
        assignments_completed: 'Assignments'
    };

    var lbls = Object.keys(importances).map(k => names[k] || k);
    var vals = Object.values(importances).map(v => parseFloat((v * 100).toFixed(1)));
    var colors = ['#2563eb', '#16a34a', '#d97706', '#7c3aed'];

    featureChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: lbls,
            datasets: [{
                label: 'Importance (%)',
                data: vals,
                backgroundColor: colors,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: '#f1f5f9' },
                    ticks: { callback: function(v) { return v + '%'; } }
                },
                y: { grid: { display: false } }
            }
        }
    });
}
