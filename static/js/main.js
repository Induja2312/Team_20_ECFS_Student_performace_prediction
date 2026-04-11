var lastResponse = null;
var allPredictions = [];
var sortDir = {};

document.querySelectorAll('.nav-item[data-page]').forEach(function(link) {
    link.addEventListener('click', function(e) {
        e.preventDefault();
        var pg = this.dataset.page;

        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

        this.classList.add('active');
        document.getElementById('page-' + pg).classList.add('active');
        document.getElementById('pageTitle').textContent = this.textContent.trim();
    });
});

document.getElementById('csvFile').addEventListener('change', function() {
    if (!this.files[0]) return;
    document.getElementById('uploadInfo').style.display = 'flex';
    document.getElementById('fileName').textContent = this.files[0].name;
    document.getElementById('uploadZone').style.display = 'none';
});

function clearFile() {
    document.getElementById('csvFile').value = '';
    document.getElementById('uploadInfo').style.display = 'none';
    document.getElementById('uploadZone').style.display = 'block';
}

async function uploadCSV() {
    var file = document.getElementById('csvFile').files[0];
    var errBox = document.getElementById('uploadError');
    var sucBox = document.getElementById('uploadSuccess');

    errBox.classList.add('hidden');
    sucBox.classList.add('hidden');

    if (!file) {
        errBox.textContent = 'Please select a CSV file first.';
        errBox.classList.remove('hidden');
        return;
    }

    document.getElementById('uploadSpinner').classList.remove('hidden');
    document.getElementById('uploadBtn').disabled = true;

    var fd = new FormData();
    fd.append('file', file);

    try {
        var resp = await fetch('/upload', { method: 'POST', body: fd });
        var data = await resp.json();

        document.getElementById('uploadSpinner').classList.add('hidden');
        document.getElementById('uploadBtn').disabled = false;

        if (data.error) {
            errBox.textContent = data.error;
            errBox.classList.remove('hidden');
            return;
        }

        lastResponse = data;
        allPredictions = data.predictions;

        sucBox.textContent = '✅ Done! ' + data.predictions.length + ' students predicted. RF Accuracy: ' + data.rf_accuracy + '%';
        sucBox.classList.remove('hidden');

        fillDashboard(data);
        fillTable(data.predictions);
        fillReportPreview(data);

        document.querySelector('.nav-item[data-page="results"]').click();

    } catch(err) {
        document.getElementById('uploadSpinner').classList.add('hidden');
        document.getElementById('uploadBtn').disabled = false;
        errBox.textContent = 'Something went wrong. Check if the server is running.';
        errBox.classList.remove('hidden');
    }
}

function fillDashboard(data) {
    var total = data.predictions.length;
    var passed = data.predictions.filter(p => p.prediction === 'Pass').length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statPass').textContent = passed;
    document.getElementById('statFail').textContent = total - passed;
    document.getElementById('statAccuracy').textContent = data.rf_accuracy + '%';

    var imp = data.feature_importances;
    var sorted = Object.entries(imp).sort((a, b) => b[1] - a[1]);
    var nameMap = {
        attendance: 'Attendance',
        marks: 'Marks',
        study_hours: 'Study Hours',
        assignments_completed: 'Assignments'
    };
    document.getElementById('topFactor').textContent = nameMap[sorted[0][0]] || sorted[0][0];
    document.getElementById('topFactorBanner').style.display = 'flex';

    document.getElementById('rfAcc').textContent = data.rf_accuracy + '%';
    document.getElementById('lrAcc').textContent = data.lr_accuracy + '%';
    document.getElementById('rfBar').style.width = data.rf_accuracy + '%';
    document.getElementById('lrBar').style.width = data.lr_accuracy + '%';

    var cm = data.confusion_matrix;
    if (cm && cm.length >= 2) {
        document.getElementById('confusionMatrix').innerHTML =
            '<strong>Confusion Matrix (Random Forest):</strong><br/>' +
            '✅ True Negatives: <strong>' + cm[0][0] + '</strong> &nbsp; ' +
            '❌ False Positives: <strong>' + cm[0][1] + '</strong><br/>' +
            '❌ False Negatives: <strong>' + cm[1][0] + '</strong> &nbsp; ' +
            '✅ True Positives: <strong>' + cm[1][1] + '</strong>';
    }

    showActionPlan(data.teacher_action_plan);
    drawRiskPie(data.risk_counts);
    drawFeatureBar(data.feature_importances);
}

function fillTable(predictions) {
    var tbody = document.getElementById('resultsBody');
    tbody.innerHTML = '';

    var batchSize = 500;
    var idx = 0;

    function nextBatch() {
        var frag = document.createDocumentFragment();
        var till = Math.min(idx + batchSize, predictions.length);

        for (var i = idx; i < till; i++) {
            var p = predictions[i];
            var tr = document.createElement('tr');
            tr.dataset.name = String(p.name).toLowerCase();
            tr.dataset.prediction = p.prediction;
            tr.dataset.risk = p.risk_level;
            tr.innerHTML =
                '<td>' + p.name + '</td>' +
                '<td>' + p.attendance + '</td>' +
                '<td>' + p.marks + '</td>' +
                '<td>' + p.study_hours + '</td>' +
                '<td>' + p.assignments_completed + '</td>' +
                '<td><span class="badge ' + (p.prediction === 'Pass' ? 'badge-pass' : 'badge-fail') + '">' + p.prediction + '</span></td>' +
                '<td><span class="badge ' + getBadge(p.risk_level) + '">' + p.risk_level + '</span></td>' +
                '<td>' + p.confidence + '%</td>';
            frag.appendChild(tr);
        }

        tbody.appendChild(frag);
        idx = till;
        if (idx < predictions.length) requestAnimationFrame(nextBatch);
    }

    nextBatch();
}

function filterTable() {
    var q = document.getElementById('searchInput').value.toLowerCase();
    var byResult = document.getElementById('filterResult').value;
    var byRisk = document.getElementById('filterRisk').value;

    document.querySelectorAll('#resultsBody tr').forEach(function(row) {
        var ok = row.dataset.name.includes(q)
            && (!byResult || row.dataset.prediction === byResult)
            && (!byRisk || row.dataset.risk === byRisk);
        row.style.display = ok ? '' : 'none';
    });
}

function sortTable(col) {
    sortDir[col] = !sortDir[col];
    var tbody = document.getElementById('resultsBody');
    var rows = Array.from(tbody.querySelectorAll('tr'));

    rows.sort(function(a, b) {
        var av = a.cells[col] ? a.cells[col].textContent.trim() : '';
        var bv = b.cells[col] ? b.cells[col].textContent.trim() : '';
        var an = parseFloat(av), bn = parseFloat(bv);
        if (!isNaN(an) && !isNaN(bn)) return sortDir[col] ? an - bn : bn - an;
        return sortDir[col] ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    rows.forEach(r => tbody.appendChild(r));
}

function downloadTableCSV() {
    if (!allPredictions.length) {
        alert('No predictions yet — upload a CSV first.');
        return;
    }

    var cols = ['Name','Attendance','Marks','Study Hours','Assignments','Prediction','Risk Level','Confidence'];
    var lines = allPredictions.map(function(p) {
        return [p.name, p.attendance, p.marks, p.study_hours,
                p.assignments_completed, p.prediction, p.risk_level, p.confidence + '%'].join(',');
    });

    var blob = new Blob([[cols.join(','), ...lines].join('\n')], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'EduPredict_Results.csv';
    a.click();
}

async function manualPredict() {
    var payload = {
        attendance: document.getElementById('m_attendance').value,
        marks: document.getElementById('m_marks').value,
        study_hours: document.getElementById('m_study_hours').value,
        assignments_completed: document.getElementById('m_assignments').value
    };

    var resp = await fetch('/predict_single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    var data = await resp.json();
    var box = document.getElementById('manualResult');
    box.classList.remove('hidden');

    if (data.error) {
        box.innerHTML = '<span style="color:var(--danger)">' + data.error + '</span>';
        return;
    }

    var pass = data.prediction === 'Pass';
    box.style.borderColor = pass ? 'var(--success)' : 'var(--danger)';

    var tipsHtml = data.improvement_tips.length
        ? '<ul>' + data.improvement_tips.map(t => '<li>' + t + '</li>').join('') + '</ul>'
        : '<p style="color:var(--success);font-size:0.88rem">🎉 Student is doing well!</p>';

    box.innerHTML =
        '<div class="result-label ' + (pass ? 'result-pass' : 'result-fail') + '">' +
        (pass ? '✅' : '❌') + ' ' + data.prediction + '</div>' +
        '<div class="result-conf">Confidence: <strong>' + data.confidence + '%</strong> &nbsp;' +
        '<span class="badge ' + getBadge(data.risk_level) + '">' + data.risk_level + '</span></div>' +
        tipsHtml;
}

function fillReportPreview(data) {
    var total = data.predictions.length;
    var passed = data.predictions.filter(p => p.prediction === 'Pass').length;
    document.getElementById('previewStats').innerHTML =
        '<strong>Total:</strong> ' + total + '<br/>' +
        '<strong>Passed:</strong> ' + passed + ' &nbsp; <strong>Failed:</strong> ' + (total - passed) + '<br/>' +
        '<strong>Safe:</strong> ' + data.risk_counts.Safe + ' &nbsp; ' +
        '<strong>At Risk:</strong> ' + data.risk_counts['At Risk'] + ' &nbsp; ' +
        '<strong>Danger:</strong> ' + data.risk_counts.Danger + '<br/>' +
        '<strong>RF Accuracy:</strong> ' + data.rf_accuracy + '% &nbsp; ' +
        '<strong>LR Accuracy:</strong> ' + data.lr_accuracy + '%';
}

async function downloadReport() {
    if (!lastResponse) {
        alert('Upload a CSV first.');
        return;
    }
    var school = document.getElementById('schoolName').value || 'EduPredict School';
    var resp = await fetch('/download_report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({}, lastResponse, { school_name: school }))
    });
    var blob = await resp.blob();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'EduPredict_Report.pdf';
    a.click();
}

function showActionPlan(plan) {
    document.getElementById('actionPlan').innerHTML = plan.map(a => '<li>' + a + '</li>').join('');
}

function getBadge(level) {
    if (level === 'Safe') return 'badge-safe';
    if (level === 'At Risk') return 'badge-risk';
    return 'badge-danger';
}
