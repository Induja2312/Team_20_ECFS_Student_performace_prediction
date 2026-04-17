import joblib
import numpy as np

FEATURE_COLS = ['attendance', 'marks', 'study_hours', 'assignments_completed']

# same weights used during training
WEIGHTS = {
    'marks': 4.0,
    'attendance': 2.5,
    'study_hours': 2.0,
    'assignments_completed': 1.5
}


def load_model():
    try:
        model = joblib.load('model/saved_model.pkl')
    except FileNotFoundError:
        raise RuntimeError('No trained model found. Upload a CSV file first to train the model.')
    return model, WEIGHTS


def get_risk_level(prediction, attendance):
    """Classify risk using ML prediction + attendance."""
    if prediction == 'Pass' and attendance >= 75:
        return 'Safe'
    if (prediction == 'Pass' and 50 <= attendance < 75) or \
       (prediction == 'Fail' and attendance >= 60):
        return 'At Risk'
    return 'Danger'


def get_attendance_feedback(attendance, marks, study_hours):
    if attendance >= 75:
        base = "Good attendance. Keep it up!"
    elif attendance >= 60:
        base = "Slightly low attendance. Needs improvement."
    elif attendance >= 50:
        base = "Low attendance. Immediate attention required."
    elif attendance >= 20:
        base = "Critically low attendance. High risk of failure."
    else:
        base = "Severely low attendance. Urgent intervention needed."

    if attendance < 60 and marks < 50:
        base += " Low attendance and low marks indicate high risk of failing."
    elif attendance < 60 and study_hours < 4:
        base += " Low attendance combined with insufficient study hours is concerning."
    return base


def get_improvement_tips(data):
    tips = []

    marks = data.get('marks', 100)
    attendance = data.get('attendance', 100)
    study = data.get('study_hours', 10)
    assignments = data.get('assignments_completed', 10)

    # below 50 marks is a straight fail regardless of everything else
    if marks < 50:
        tips.append("Marks below 50 — student has not reached the minimum pass mark.")
    elif marks < 60:
        tips.append("Marks are low. Target at least 60 to be safe.")

    if attendance < 50:
        tips.append("Attendance is critically low. Attend all remaining classes.")
    elif attendance < 75:
        tips.append("Attendance is below 75%. Try to attend more classes.")

    if study < 4:
        tips.append("Increase study hours to at least 4 hours per week.")

    if assignments < 5:
        tips.append("Complete pending assignments. Aim for at least 7 out of 10.")

    return tips


def predict_student(data):
    model, weights = load_model()

    weighted_input = [[
        data['attendance'] * weights['attendance'],
        data['marks'] * weights['marks'],
        data['study_hours'] * weights['study_hours'],
        data.get('assignments_completed', 5) * weights['assignments_completed']
    ]]

    proba = model.predict_proba(weighted_input)[0]
    pass_conf = round(proba[1] * 100, 2)

    prediction = 'Pass' if pass_conf >= 50 else 'Fail'
    return {
        'prediction': prediction,
        'confidence': pass_conf,
        'risk_level': get_risk_level(prediction, data['attendance']),
        'feedback': get_attendance_feedback(data['attendance'], data['marks'], data['study_hours']),
        'improvement_tips': get_improvement_tips(data)
    }
