var lastResponse = null;
var allPredictions = [];
var sortDir = {};

// restore last session on page load
(function() {
    var saved = sessionStorage.getItem('edupredict_last');
    if (saved) {
        try {
            lastResponse = JSON.parse(saved);
            allPredictions = lastResponse.predictions;
            window.addEventListener('load', function() {
                fillDashboard(lastResponse);
                fillTable(lastResponse.predictions);
                fillReportPreview(lastResponse);
                populateClassFilters(lastResponse.predictions);
            });
        } catch(e) { sessionStorage.removeItem('edupredict_last'); }
    }
})();

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
        showError(errBox, '📂 No file selected. Please choose a CSV file before uploading.');
        return;
    }
    if (!file.name.endsWith('.csv')) {
        showError(errBox, '📄 Wrong file type. Only CSV files are supported. Please upload a .csv file.');
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
            showError(errBox, friendlyUploadError(data.error));
            return;
        }

        lastResponse = data;
        allPredictions = data.predictions;
        sessionStorage.setItem('edupredict_last', JSON.stringify(data));

        sucBox.textContent = '✅ Done! ' + data.predictions.length + ' students predicted. RF Accuracy: ' + data.rf_accuracy + '%';
        sucBox.classList.remove('hidden');

        fillDashboard(data);
        fillTable(data.predictions);
        fillReportPreview(data);
        populateClassFilters(data.predictions);

        document.querySelector('.nav-item[data-page="results"]').click();

    } catch(err) {
        document.getElementById('uploadSpinner').classList.add('hidden');
        document.getElementById('uploadBtn').disabled = false;
        showError(errBox, '🔌 Could not reach the server. Make sure the app is running and try again.');
    }
}

function showError(box, msg) {
    box.textContent = msg;
    box.classList.remove('hidden');
}

function friendlyUploadError(err) {
    if (err.includes('columns')) return '📋 Your CSV doesn\'t have enough columns. Required: name, attendance, marks, study_hours, result. Check the format and try again.';
    if (err.includes('empty') || err.includes('Empty')) return '📄 The uploaded file appears to be empty. Please check the file and try again.';
    if (err.includes('model') || err.includes('train')) return '🤖 Model training failed. Make sure your CSV has valid numeric values for attendance, marks, and study hours.';
    return '⚠️ ' + err;
}

// collect unique non-empty classes from predictions
function getClasses(predictions) {
    var seen = {};
    var classes = [];
    predictions.forEach(function(p) {
        var c = (p['class'] || '').trim();
        if (c && !seen[c]) { seen[c] = true; classes.push(c); }
    });
    return classes.sort();
}

function populateClassFilters(predictions) {
    var classes = getClasses(predictions);
    var hasClass = classes.length > 0;

    // results page filter
    var sel = document.getElementById('filterClass');
    sel.innerHTML = '<option value="">All Classes</option>';
    classes.forEach(function(c) { sel.innerHTML += '<option value="' + c + '">' + c + '</option>'; });
    document.getElementById('classFilterWrap').style.display = hasClass ? '' : 'none';

    // dashboard class filter
    var dsel = document.getElementById('dashFilterClass');
    dsel.innerHTML = '<option value="">All Classes</option>';
    classes.forEach(function(c) { dsel.innerHTML += '<option value="' + c + '">' + c + '</option>'; });
    document.getElementById('dashClassFilterWrap').style.display = hasClass ? '' : 'none';
    document.getElementById('classChartsSection').style.display = hasClass ? '' : 'none';
}

function fillDashboard(data) {
    var preds = data.predictions;
    var classFilter = document.getElementById('dashFilterClass') ? document.getElementById('dashFilterClass').value : '';
    var filtered = classFilter ? preds.filter(function(p) { return (p['class'] || '') === classFilter; }) : preds;

    var total = filtered.length;
    var passed = filtered.filter(p => p.prediction === 'Pass').length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statPass').textContent = passed;
    document.getElementById('statFail').textContent = total - passed;
    document.getElementById('statAccuracy').textContent = data.rf_accuracy + '%';

    var safe   = filtered.filter(p => p.risk_level === 'Safe').length;
    var atRisk = filtered.filter(p => p.risk_level === 'At Risk').length;
    var danger = filtered.filter(p => p.risk_level === 'Danger').length;

    document.getElementById('statSafe').textContent   = safe;
    document.getElementById('statAtRisk').textContent = atRisk;
    document.getElementById('statDanger').textContent = danger;
    document.getElementById('statSafePct').textContent   = total ? ((safe   / total) * 100).toFixed(1) + '% of students' : '';
    document.getElementById('statAtRiskPct').textContent = total ? ((atRisk / total) * 100).toFixed(1) + '% of students' : '';
    document.getElementById('statDangerPct').textContent = total ? ((danger / total) * 100).toFixed(1) + '% of students' : '';
    document.getElementById('riskStatsGrid').style.display = 'grid';

    var imp = data.feature_importances;
    var sorted = Object.entries(imp).sort((a, b) => b[1] - a[1]);
    var nameMap = { attendance: 'Attendance', marks: 'Marks', study_hours: 'Study Hours', assignments_completed: 'Assignments' };
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
    drawRiskPie({ Safe: safe, 'At Risk': atRisk, Danger: danger });
    drawFeatureBar(data.feature_importances);

    // class-wise charts (always use full predictions, not filtered)
    var classes = getClasses(preds);
    if (classes.length > 0) {
        drawClassRiskBar(preds, classes);
        drawClassPassBar(preds, classes);
        drawClassAvgBar(preds, classes);
    }
}

function fillTable(predictions) {
    var tbody = document.getElementById('resultsBody');
    tbody.innerHTML = '';
    var batchSize = 500;
    var idx = 0;

    var hasClass = predictions.some(p => (p['class'] || '').trim() !== '');

    function nextBatch() {
        var frag = document.createDocumentFragment();
        var till = Math.min(idx + batchSize, predictions.length);
        for (var i = idx; i < till; i++) {
            var p = predictions[i];
            var tr = document.createElement('tr');
            tr.dataset.name = String(p.name).toLowerCase();
            tr.dataset.prediction = p.prediction;
            tr.dataset.risk = p.risk_level;
            tr.dataset.cls = (p['class'] || '').trim();
            tr.innerHTML =
                '<td>' + p.name + '</td>' +
                (hasClass ? '<td>' + (p['class'] || '—') + '</td>' : '') +
                '<td>' + p.attendance + '</td>' +
                '<td>' + p.marks + '</td>' +
                '<td>' + p.study_hours + '</td>' +
                '<td>' + (p.has_assignments ? p.assignments_completed : '—') + '</td>' +
                '<td><span class="badge ' + (p.prediction === 'Pass' ? 'badge-pass' : 'badge-fail') + '">' + p.prediction + '</span></td>' +
                '<td><span class="badge ' + getBadge(p.risk_level) + '">' + p.risk_level + '</span></td>' +
                '<td>' + p.confidence + '%</td>' +
                '<td style="font-size:0.8rem;color:var(--muted);max-width:220px">' + (p.feedback || '') + '</td>';
            frag.appendChild(tr);
        }
        tbody.appendChild(frag);
        idx = till;

        // show/hide class column header
        var classHeader = document.getElementById('thClass');
        if (classHeader) classHeader.style.display = hasClass ? '' : 'none';

        if (idx < predictions.length) requestAnimationFrame(nextBatch);
    }
    nextBatch();
}

function filterTable() {
    var q       = document.getElementById('searchInput').value.toLowerCase();
    var byResult = document.getElementById('filterResult').value;
    var byRisk   = document.getElementById('filterRisk').value;
    var byClass  = document.getElementById('filterClass').value;

    document.querySelectorAll('#resultsBody tr').forEach(function(row) {
        var ok = row.dataset.name.includes(q)
            && (!byResult || row.dataset.prediction === byResult)
            && (!byRisk   || row.dataset.risk === byRisk)
            && (!byClass  || row.dataset.cls === byClass);
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

async function downloadTableCSV() {
    if (!lastResponse) {
        alert('📂 No data to download yet. Please upload a CSV file first.');
        return;
    }
    var resp = await fetch('/download-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastResponse)
    });
    var blob = await resp.blob();
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'EduPredict_Results.csv';
    a.click();
}

async function manualPredict() {
    var att   = document.getElementById('m_attendance').value;
    var marks = document.getElementById('m_marks').value;
    var study = document.getElementById('m_study_hours').value;
    var asgn  = document.getElementById('m_assignments').value;
    var box   = document.getElementById('manualResult');

    box.classList.remove('hidden');

    var payload = {
        attendance: att, marks: marks, study_hours: study,
        assignments_completed: asgn
    };

    try {
        var resp = await fetch('/predict_single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        var data = await resp.json();

        if (data.error) {
            box.style.borderColor = 'var(--danger)';
            if (typeof data.error === 'object') {
                // field-level errors
                var msgs = Object.entries(data.error).map(function([field, msg]) {
                    return '<li><strong>' + field.replace('_', ' ') + ':</strong> ' + msg + '</li>';
                }).join('');
                box.innerHTML = '<span style="color:var(--danger)">⚠️ Please fix the following:</span><ul style="margin:0.4rem 0 0 1rem;color:var(--danger)">' + msgs + '</ul>';
            } else if (typeof data.error === 'string' && (data.error.includes('model') || data.error.includes('trained'))) {
                box.innerHTML = '<span style="color:var(--danger)">🤖 No trained model found. Please upload a CSV file first to train the model.</span>';
            } else {
                box.innerHTML = '<span style="color:var(--danger)">⚠️ ' + data.error + '</span>';
            }
            return;
        }

        var pass = data.prediction === 'Pass';
        box.style.borderColor = pass ? 'var(--success)' : 'var(--danger)';
        var tipsHtml = data.improvement_tips.length
            ? '<ul>' + data.improvement_tips.map(t => '<li>' + t + '</li>').join('') + '</ul>'
            : '<p style="color:var(--success);font-size:0.88rem">🎉 Student is doing well!</p>';

        var asgnLine = asgn !== ''
            ? '<span style="font-size:0.82rem;color:var(--muted)"> &nbsp;·&nbsp; Assignments: ' + asgn + '/10</span>'
            : '<span style="font-size:0.82rem;color:var(--muted)"> &nbsp;·&nbsp; Assignments: —</span>';

        box.innerHTML =
            '<div class="result-label ' + (pass ? 'result-pass' : 'result-fail') + '">' +
            (pass ? '✅' : '❌') + ' ' + data.prediction + '</div>' +
            '<div class="result-conf">Confidence: <strong>' + data.confidence + '%</strong> &nbsp;' +
            '<span class="badge ' + getBadge(data.risk_level) + '">' + data.risk_level + '</span>' +
            asgnLine + '</div>' +
            '<div style="font-size:0.85rem;color:var(--muted);margin:0.5rem 0 0.8rem">💬 ' + data.feedback + '</div>' +
            tipsHtml;
    } catch(e) {
        box.style.borderColor = 'var(--danger)';
        box.innerHTML = '<span style="color:var(--danger)">🔌 Could not reach the server. Make sure the app is running.</span>';
    }
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
        alert('📂 No data available. Please upload a CSV file first.');
        return;
    }
    var resp = await fetch('/download-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lastResponse)
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
