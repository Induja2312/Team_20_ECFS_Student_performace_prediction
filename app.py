from flask import Flask, request, jsonify, render_template, send_file
import pandas as pd
import io
import os
import json
import joblib
from datetime import datetime
from model.train import run_training, FEATURE_COLS
from model.predict import predict_student, WEIGHTS, get_risk_level, get_improvement_tips, get_attendance_feedback
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet

app = Flask(__name__)

UPLOAD_FOLDER = 'uploads'
REPORT_FOLDER = 'reports'
HISTORY_FOLDER = 'history'

for folder in [UPLOAD_FOLDER, REPORT_FOLDER, HISTORY_FOLDER]:
    os.makedirs(folder, exist_ok=True)


def build_action_plan(predictions):
    danger_count = sum(1 for p in predictions if p['risk_level'] == 'Danger')
    at_risk_count = sum(1 for p in predictions if p['risk_level'] == 'At Risk')
    low_att_count = sum(1 for p in predictions if p.get('attendance', 100) < 60)

    plan = []
    if danger_count:
        plan.append(f"Call parents of {danger_count} student(s) in Danger zone immediately.")
    if at_risk_count:
        plan.append(f"Schedule extra classes for {at_risk_count} At Risk student(s).")
    if low_att_count:
        plan.append(f"Recommend counselling for {low_att_count} student(s) with attendance below 60%.")
    if not plan:
        plan.append("All students are performing well. Keep monitoring regularly.")
    return plan


def make_student_story(name, marks, attendance, study):
    if marks >= 75 and attendance < 75:
        return f"{name} is brilliant but skipping class too often."
    if marks < 50 and study < 4:
        return f"{name} needs to study more and focus on exams."
    if attendance >= 90 and marks >= 70:
        return f"{name} is consistent and performing excellently."
    if marks < 50:
        return f"{name} is struggling with exam performance."
    if attendance < 60:
        return f"{name} has very low attendance which is affecting results."
    return f"{name} is on track but can improve further."


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({'error': 'Empty filename'}), 400

    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    save_path = os.path.join(UPLOAD_FOLDER, f"{ts}_{file.filename}")
    file.save(save_path)

    try:
        train_results = run_training(save_path)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    df = pd.read_csv(save_path, header=None, low_memory=False)
    # skip header row if first cell is text
    if not str(df.iloc[0, 0]).strip().replace('.','').isdigit():
        df = df.iloc[1:].reset_index(drop=True)
    # capture original column count BEFORE any mapping
    orig_cols = df.shape[1]
    # map columns by position — assignments_completed and class are optional
    if df.shape[1] >= 7:
        col_names = ['name', 'attendance', 'marks', 'study_hours', 'assignments_completed', 'class', 'result']
        if df.shape[1] > 7:
            col_names += [f'extra_{i}' for i in range(df.shape[1] - 7)]
        df.columns = col_names
    elif df.shape[1] == 6:
        col_names = ['name', 'attendance', 'marks', 'study_hours', 'assignments_completed', 'result']
        df.columns = col_names
        df['class'] = ''
    else:
        df.columns = ['name', 'attendance', 'marks', 'study_hours', 'result']
        df['assignments_completed'] = 5
        df['class'] = ''
    df = df[['name', 'attendance', 'marks', 'study_hours', 'assignments_completed', 'class', 'result']]
    for col in FEATURE_COLS:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df['assignments_completed'] = df['assignments_completed'].fillna(5)
    df = df.dropna(subset=['attendance', 'marks', 'study_hours'])
    if len(df) > 10000:
        df = df.sample(n=10000, random_state=42).reset_index(drop=True)

    # has_assignments = True only if the original CSV actually had that column
    # 5-col: name,att,marks,study,result — no assignments
    # 6-col: name,att,marks,study,assignments,result — has assignments
    # 7-col: name,att,marks,study,assignments,class,result — has assignments
    has_assignments = orig_cols >= 6

    model = joblib.load('model/saved_model.pkl')

    X = df[FEATURE_COLS].copy()
    for col, w in WEIGHTS.items():
        X[col] = X[col] * w

    all_proba = model.predict_proba(X)
    confidences = (all_proba[:, 1] * 100).round(2)

    predictions = []
    for i, (_, row) in enumerate(df.iterrows()):
        conf = float(confidences[i])
        sdata = {
            'attendance': float(row['attendance']),
            'marks': float(row['marks']),
            'study_hours': float(row['study_hours']),
            'assignments_completed': float(row['assignments_completed'])
        }
        name = str(row['name']) if 'name' in df.columns else f"Student {i + 1}"
        prediction = 'Pass' if conf >= 50 else 'Fail'
        now = datetime.now()
        predictions.append({
            'name': name,
            'class': str(row.get('class', '')),
            **sdata,
            'has_assignments': has_assignments,
            'prediction': prediction,
            'confidence': conf,
            'risk_level': get_risk_level(prediction, sdata['attendance']),
            'feedback': get_attendance_feedback(sdata['attendance'], sdata['marks'], sdata['study_hours']),
            'improvement_tips': get_improvement_tips(sdata),
            'story': make_student_story(name, sdata['marks'], sdata['attendance'], sdata['study_hours']),
            'date': now.strftime('%Y-%m-%d'),
            'time': now.strftime('%H:%M:%S')
        })

    risk_counts = {
        'Safe': sum(1 for p in predictions if p['risk_level'] == 'Safe'),
        'At Risk': sum(1 for p in predictions if p['risk_level'] == 'At Risk'),
        'Danger': sum(1 for p in predictions if p['risk_level'] == 'Danger')
    }

    response = {
        **train_results,
        'predictions': predictions,
        'risk_counts': risk_counts,
        'teacher_action_plan': build_action_plan(predictions)
    }

    ts2 = datetime.now().strftime('%Y%m%d_%H%M%S')
    history_path = os.path.join(HISTORY_FOLDER, f'{ts2}.json')
    with open(history_path, 'w') as f:
        json.dump({'timestamp': ts2, 'data': response}, f)

    return jsonify(response)


def validate_predict_input(data):
    """Returns dict of field-level errors, or empty dict if valid."""
    errors = {}
    required = {'attendance': 'Attendance is required',
                 'marks': 'Marks are required',
                 'study_hours': 'Study Hours are required'}
    for field, msg in required.items():
        if data.get(field) in (None, ''):
            errors[field] = msg
            continue
        try:
            val = float(data[field])
        except (ValueError, TypeError):
            errors[field] = f'{field.replace("_", " ").title()} must be a number'
            continue
        if field in ('attendance', 'marks') and not (0 <= val <= 100):
            errors[field] = f'{field.replace("_", " ").title()} must be between 0 and 100'
        elif field == 'study_hours' and val < 0:
            errors[field] = 'Study Hours must be >= 0'
    return errors


@app.route('/predict_single', methods=['POST'])
def predict_single():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    errors = validate_predict_input(data)
    if errors:
        return jsonify({'error': errors}), 400
    try:
        result = predict_student({
            'attendance': float(data['attendance']),
            'marks': float(data['marks']),
            'study_hours': float(data['study_hours']),
            'assignments_completed': float(data['assignments_completed']) if data.get('assignments_completed') not in (None, '') else 0
        })
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/history')
def history():
    sessions = []
    for fname in sorted(os.listdir(HISTORY_FOLDER), reverse=True):
        if fname.endswith('.json'):
            with open(os.path.join(HISTORY_FOLDER, fname)) as f:
                session = json.load(f)
            ts = session.get('timestamp', '')
            # parse date and time from timestamp string YYYYMMDD_HHMMSS
            try:
                dt = datetime.strptime(ts, '%Y%m%d_%H%M%S')
                session['date'] = dt.strftime('%d %B %Y')
                session['time'] = dt.strftime('%I:%M:%S %p')
            except Exception:
                session['date'] = ts
                session['time'] = ''
            sessions.append(session)
    return render_template('history.html', sessions=sessions)


@app.route('/history_api')
def history_api():
    records = []
    for fname in sorted(os.listdir(HISTORY_FOLDER), reverse=True):
        if fname.endswith('.json'):
            with open(os.path.join(HISTORY_FOLDER, fname)) as f:
                session = json.load(f)
            for p in session.get('data', {}).get('predictions', []):
                records.append({
                    'name': p.get('name', ''),
                    'attendance': p.get('attendance', ''),
                    'marks': p.get('marks', ''),
                    'study_hours': p.get('study_hours', ''),
                    'prediction': p.get('prediction', ''),
                    'risk_level': p.get('risk_level', ''),
                    'feedback': p.get('feedback', ''),
                    'date': p.get('date', ''),
                    'time': p.get('time', '')
                })
    return jsonify(records)


@app.route('/download_report', methods=['POST'])
def download_report():
    data = request.get_json()
    predictions = data.get('predictions', [])
    risk_counts = data.get('risk_counts', {})
    rf_acc = data.get('rf_accuracy', 'N/A')
    lr_acc = data.get('lr_accuracy', 'N/A')

    fname = f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
    fpath = os.path.join(REPORT_FOLDER, fname)

    doc = SimpleDocTemplate(fpath, pagesize=A4)
    styles = getSampleStyleSheet()
    elems = []

    elems.append(Paragraph("EduPredict — Student Performance Report", styles['Title']))
    elems.append(Paragraph(f"Date: {datetime.now().strftime('%d %B %Y')}", styles['Normal']))
    elems.append(Spacer(1, 12))

    has_class = any(p.get('class', '').strip() for p in predictions)

    tbl_style = TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a2e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')])
    ])

    if has_class:
        from collections import defaultdict
        grouped = defaultdict(list)
        for p in predictions:
            grouped[p.get('class', '').strip() or 'Unknown'].append(p)

        for cls in sorted(grouped.keys()):
            group = grouped[cls]
            elems.append(Paragraph(f"Class: {cls}", styles['Heading2']))
            safe   = sum(1 for p in group if p.get('risk_level') == 'Safe')
            at_risk= sum(1 for p in group if p.get('risk_level') == 'At Risk')
            danger = sum(1 for p in group if p.get('risk_level') == 'Danger')
            elems.append(Paragraph(
                f"Students: {len(group)}  |  Safe: {safe}  |  At Risk: {at_risk}  |  Danger: {danger}",
                styles['Normal']
            ))
            elems.append(Spacer(1, 6))
            rows = [['Name', 'Class', 'Marks', 'Attendance', 'Prediction', 'Confidence', 'Risk']]
            for p in group:
                rows.append([p.get('name',''), p.get('class',''), p.get('marks',''),
                              p.get('attendance',''), p.get('prediction',''),
                              f"{p.get('confidence','')}%", p.get('risk_level','')])
            tbl = Table(rows, repeatRows=1)
            tbl.setStyle(tbl_style)
            elems.append(tbl)
            elems.append(Spacer(1, 16))
    else:
        rows = [['Name', 'Marks', 'Attendance', 'Study Hours', 'Prediction', 'Confidence', 'Risk', 'Feedback']]
        for p in predictions:
            rows.append([p.get('name',''), p.get('marks',''), p.get('attendance',''),
                         p.get('study_hours',''), p.get('prediction',''),
                         f"{p.get('confidence','')}%", p.get('risk_level',''),
                         p.get('feedback','')])
        tbl = Table(rows, repeatRows=1, colWidths=[70, 35, 50, 45, 50, 55, 40, None])
        tbl.setStyle(tbl_style)
        elems.append(tbl)

    # Risk Analysis Summary
    total = len(predictions)
    safe_c   = risk_counts.get('Safe', 0)
    risk_c   = risk_counts.get('At Risk', 0)
    danger_c = risk_counts.get('Danger', 0)
    elems.append(Spacer(1, 20))
    elems.append(Paragraph("Risk Analysis Summary", styles['Heading2']))
    summary_data = [
        ['Metric', 'Count'],
        ['Total Students', str(total)],
        ['SAFE', str(safe_c)],
        ['AT RISK', str(risk_c)],
        ['DANGER', str(danger_c)],
    ]
    summary_tbl = Table(summary_data, colWidths=[160, 80])
    summary_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a2e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('BACKGROUND', (0, 2), (-1, 2), colors.HexColor('#fff3cd')),
        ('BACKGROUND', (0, 3), (-1, 3), colors.HexColor('#f8d7da')),
    ]))
    elems.append(summary_tbl)
    elems.append(Spacer(1, 16))
    elems.append(Paragraph("Model Accuracy", styles['Heading2']))
    acc_data = [
        ['Model', 'Accuracy'],
        ['Random Forest', f'{rf_acc}%'],
        ['Logistic Regression', f'{lr_acc}%'],
    ]
    acc_tbl = Table(acc_data, colWidths=[160, 80])
    acc_tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a2e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')]),
    ]))
    elems.append(acc_tbl)

    doc.build(elems)
    return send_file(fpath, as_attachment=True, download_name=fname)


@app.route('/download-csv', methods=['POST'])
def download_csv():
    data = request.get_json()
    predictions = data.get('predictions', [])
    risk_counts = data.get('risk_counts', {})

    lines = ['Name,Attendance,Marks,Study Hours,Prediction,Risk,Feedback,Date,Time']
    for p in predictions:
        row = [
            str(p.get('name', '')),
            str(p.get('attendance', '')),
            str(p.get('marks', '')),
            str(p.get('study_hours', '')),
            str(p.get('prediction', '')),
            str(p.get('risk_level', '')),
            f'"{p.get("feedback", "").replace(chr(34), chr(39))}"',
            str(p.get('date', '')),
            str(p.get('time', ''))
        ]
        lines.append(','.join(row))

    total = len(predictions)
    lines += [
        '',
        '--- Risk Analysis Summary ---',
        f'Total Students,{total}',
        f'SAFE,{risk_counts.get("Safe", 0)}',
        f'AT RISK,{risk_counts.get("At Risk", 0)}',
        f'DANGER,{risk_counts.get("Danger", 0)}'
    ]

    output = io.BytesIO('\n'.join(lines).encode('utf-8'))
    output.seek(0)
    fname = f"EduPredict_Results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    return send_file(output, mimetype='text/csv', as_attachment=True, download_name=fname)


@app.route('/download-pdf', methods=['POST'])
def download_pdf():
    return download_report()


if __name__ == '__main__':
    app.run(debug=True)
