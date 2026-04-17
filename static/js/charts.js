var riskChart = null;
var featureChart = null;
var classRiskChart = null;
var classPassChart = null;
var classAvgChart = null;

function drawRiskPie(counts) {
    var ctx = document.getElementById('riskPieChart').getContext('2d');
    if (riskChart) riskChart.destroy();
    riskChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Safe', 'At Risk', 'Danger'],
            datasets: [{ data: [counts['Safe'], counts['At Risk'], counts['Danger']],
                backgroundColor: ['#16a34a', '#d97706', '#dc2626'], borderColor: '#fff', borderWidth: 3 }]
        },
        options: { cutout: '65%', plugins: { legend: { position: 'bottom', labels: { padding: 16, font: { size: 12 } } } } }
    });
}

function drawFeatureBar(importances) {
    var ctx = document.getElementById('featureBarChart').getContext('2d');
    if (featureChart) featureChart.destroy();
    var names = { attendance: 'Attendance', marks: 'Marks', study_hours: 'Study Hours', assignments_completed: 'Assignments' };
    var lbls = Object.keys(importances).map(k => names[k] || k);
    var vals = Object.values(importances).map(v => parseFloat((v * 100).toFixed(1)));
    featureChart = new Chart(ctx, {
        type: 'bar',
        data: { labels: lbls, datasets: [{ label: 'Importance (%)', data: vals,
            backgroundColor: ['#2563eb', '#16a34a', '#d97706', '#7c3aed'], borderRadius: 6, borderSkipped: false }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, max: 100, grid: { color: '#f1f5f9' },
                ticks: { callback: function(v) { return v + '%'; } } }, y: { grid: { display: false } } } }
    });
}

// class-wise: Safe / At Risk / Danger stacked bar
function drawClassRiskBar(predictions, classes) {
    var ctx = document.getElementById('classRiskChart').getContext('2d');
    if (classRiskChart) classRiskChart.destroy();

    var safe = [], atRisk = [], danger = [];
    classes.forEach(function(cls) {
        var g = predictions.filter(p => (p['class'] || '') === cls);
        safe.push(g.filter(p => p.risk_level === 'Safe').length);
        atRisk.push(g.filter(p => p.risk_level === 'At Risk').length);
        danger.push(g.filter(p => p.risk_level === 'Danger').length);
    });

    classRiskChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: classes,
            datasets: [
                { label: 'Safe',    data: safe,   backgroundColor: '#16a34a' },
                { label: 'At Risk', data: atRisk, backgroundColor: '#d97706' },
                { label: 'Danger',  data: danger, backgroundColor: '#dc2626' }
            ]
        },
        options: { plugins: { legend: { position: 'bottom' } },
            scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

// class-wise: Pass vs Fail grouped bar
function drawClassPassBar(predictions, classes) {
    var ctx = document.getElementById('classPassChart').getContext('2d');
    if (classPassChart) classPassChart.destroy();

    var pass = [], fail = [];
    classes.forEach(function(cls) {
        var g = predictions.filter(p => (p['class'] || '') === cls);
        pass.push(g.filter(p => p.prediction === 'Pass').length);
        fail.push(g.filter(p => p.prediction === 'Fail').length);
    });

    classPassChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: classes,
            datasets: [
                { label: 'Pass', data: pass, backgroundColor: '#2563eb', borderRadius: 4 },
                { label: 'Fail', data: fail, backgroundColor: '#dc2626', borderRadius: 4 }
            ]
        },
        options: { plugins: { legend: { position: 'bottom' } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

// class-wise: avg attendance, marks, study hours
function drawClassAvgBar(predictions, classes) {
    var ctx = document.getElementById('classAvgChart').getContext('2d');
    if (classAvgChart) classAvgChart.destroy();

    var avgAtt = [], avgMarks = [], avgStudy = [];
    classes.forEach(function(cls) {
        var g = predictions.filter(p => (p['class'] || '') === cls);
        var n = g.length || 1;
        avgAtt.push(parseFloat((g.reduce((s, p) => s + p.attendance, 0) / n).toFixed(1)));
        avgMarks.push(parseFloat((g.reduce((s, p) => s + p.marks, 0) / n).toFixed(1)));
        avgStudy.push(parseFloat((g.reduce((s, p) => s + p.study_hours, 0) / n).toFixed(1)));
    });

    classAvgChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: classes,
            datasets: [
                { label: 'Avg Attendance (%)', data: avgAtt,   backgroundColor: '#2563eb', borderRadius: 4 },
                { label: 'Avg Marks',          data: avgMarks, backgroundColor: '#16a34a', borderRadius: 4 },
                { label: 'Avg Study Hrs',      data: avgStudy, backgroundColor: '#d97706', borderRadius: 4 }
            ]
        },
        options: { plugins: { legend: { position: 'bottom' } },
            scales: { y: { beginAtZero: true } } }
    });
}
