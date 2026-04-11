var sliderVals = {
    attendance: 75,
    marks: 60,
    study_hours: 5,
    assignments_completed: 6
};

var debounceTimer = null;

function updateSim(field, val) {
    sliderVals[field] = parseFloat(val);
    document.getElementById('val_' + field).textContent = val;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runSimPredict, 280);
}

async function runSimPredict() {
    var box = document.getElementById('simResult');

    try {
        var resp = await fetch('/predict_single', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sliderVals)
        });

        var data = await resp.json();

        if (data.error) {
            box.innerHTML = '<span style="color:var(--danger)">' + data.error + '</span>';
            return;
        }

        var pass = data.prediction === 'Pass';
        var bc = data.risk_level === 'Safe' ? 'badge-safe' : data.risk_level === 'At Risk' ? 'badge-risk' : 'badge-danger';

        box.style.borderLeftColor = pass ? 'var(--success)' : 'var(--danger)';

        var tipsHtml = '';
        if (data.improvement_tips.length > 0) {
            tipsHtml = '<ul>' + data.improvement_tips.map(t => '<li>' + t + '</li>').join('') + '</ul>';
        } else {
            tipsHtml = '<p style="color:var(--success);margin-top:0.4rem;font-size:0.85rem">🎉 Student is on track!</p>';
        }

        box.innerHTML =
            '<strong style="font-size:1.05rem;color:' + (pass ? 'var(--success)' : 'var(--danger)') + '">' +
            (pass ? '✅' : '❌') + ' ' + data.prediction + '</strong>' +
            ' &nbsp; Confidence: <strong>' + data.confidence + '%</strong>' +
            ' &nbsp; <span class="badge ' + bc + '">' + data.risk_level + '</span>' +
            tipsHtml;

    } catch(e) {
        box.innerHTML = '<span class="sim-placeholder">Upload a CSV first to enable predictions.</span>';
    }
}

window.addEventListener('load', runSimPredict);
