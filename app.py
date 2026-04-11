from flask import Flask, request, jsonify, render_template, send_file
import pandas as pd
import os
import json
import joblib
from datetime import datetime
from model.train import run_training, FEATURE_COLS
from model.predict import predict_student, WEIGHTS, get_risk_level, get_improvement_tips
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
    # map columns by position same as train.py
    col_names = ['name', 'attendance', 'marks', 'study_hours', 'assignments_completed', 'result']
    if df.shape[1] > 6:
        col_names += [f'extra_{i}' for i in range(df.shape[1] - 6)]
    df.columns = col_names
    df = df[['name', 'attendance', 'marks', 'study_hours', 'assignments_completed', 'result']]
    for col in FEATURE_COLS:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df = df.dropna(subset=FEATURE_COLS)
    if len(df) > 10000:
        df = df.sample(n=10000, random_state=42).reset_index(drop=True)

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
        predictions.append({
            'name': name,
            **sdata,
            'prediction': 'Pass' if conf >= 50 else 'Fail',
            'confidence': conf,
            'risk_level': get_risk_level(conf),
            'improvement_tips': get_improvement_tips(sdata),
            'story': make_student_story(name, sdata['marks'], sdata['attendance'], sdata['study_hours'])
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


@app.route('/predict_single', methods=['POST'])
def predict_single():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400
    try:
        result = predict_student({
            'attendance': float(data['attendance']),
            'marks': float(data['marks']),
            'study_hours': float(data['study_hours']),
            'assignments_completed': float(data['assignments_completed'])
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
                sessions.append(json.load(f))
    return render_template('history.html', sessions=sessions)


@app.route('/download_report', methods=['POST'])
def download_report():
    data = request.get_json()
    school = data.get('school_name', 'EduPredict School')
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
    elems.append(Paragraph(f"School: {school}", styles['Normal']))
    elems.append(Paragraph(f"Date: {datetime.now().strftime('%d %B %Y')}", styles['Normal']))
    elems.append(Spacer(1, 12))
    elems.append(Paragraph(f"Random Forest Accuracy: {rf_acc}%", styles['Normal']))
    elems.append(Paragraph(f"Logistic Regression Accuracy: {lr_acc}%", styles['Normal']))
    elems.append(Spacer(1, 12))
    elems.append(Paragraph("Risk Distribution:", styles['Heading2']))

    for level, count in risk_counts.items():
        elems.append(Paragraph(f"  {level}: {count} student(s)", styles['Normal']))
    elems.append(Spacer(1, 12))

    rows = [['Name', 'Marks', 'Attendance', 'Prediction', 'Confidence', 'Risk']]
    for p in predictions:
        rows.append([
            p.get('name', ''),
            p.get('marks', ''),
            p.get('attendance', ''),
            p.get('prediction', ''),
            f"{p.get('confidence', '')}%",
            p.get('risk_level', '')
        ])

    tbl = Table(rows, repeatRows=1)
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1a1a2e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f5f5')])
    ]))
    elems.append(tbl)

    doc.build(elems)
    return send_file(fpath, as_attachment=True, download_name=fname)


if __name__ == '__main__':
    app.run(debug=True)
