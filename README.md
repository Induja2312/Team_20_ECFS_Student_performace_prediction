# EduPredict — Student Performance Predictor

A web-based machine learning application that predicts student pass/fail outcomes based on attendance, marks, study hours, and assignments completed.

## Features
- Upload any CSV file to train the model and predict all students
- Random Forest + Logistic Regression models
- Risk levels: Safe, At Risk, Danger
- Analytics dashboard with charts
- What-If simulator with live predictions
- PDF and CSV report download
- Session history

## Tech Stack
- Python, Flask
- scikit-learn, pandas
- Chart.js
- ReportLab

## Setup

1. Clone the repository
```
git clone https://github.com/YOUR_USERNAME/student_predictor.git
cd student_predictor
```

2. Create virtual environment
```
py -m venv venv
venv\Scripts\activate
```

3. Install dependencies
```
py -m pip install -r requirements.txt
```

4. Run the app
```
py app.py
```

5. Open browser at `http://127.0.0.1:5000`

## CSV Format
Your CSV must have 6 columns in this order:
```
name, attendance, marks, study_hours, assignments_completed, result
```
- result column: `pass` or `fail`
- Column names don't matter — position does

## Feature Weights
| Feature | Weight |
|---|---|
| Marks | 40% |
| Attendance | 25% |
| Study Hours | 20% |
| Assignments | 15% |
