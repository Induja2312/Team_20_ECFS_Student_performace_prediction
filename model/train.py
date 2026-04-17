import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, confusion_matrix
import joblib
import os

# these are the 4 things we track for each student
FEATURE_COLS = ['attendance', 'marks', 'study_hours', 'assignments_completed']

# i decided on these weights based on how much each factor
# actually matters in real academic performance
# marks carry the most weight (40%), then attendance (25%),
# study hours (20%) and assignments (15%)
WEIGHTS = {
    'marks': 4.0,
    'attendance': 2.5,
    'study_hours': 2.0,
    'assignments_completed': 1.5
}


def load_and_clean_data(filepath):
    df = pd.read_csv(filepath, header=None, low_memory=False)

    if df.shape[1] < 5:
        raise ValueError(f"Your file has only {df.shape[1]} columns. Need at least 5.")

    # skip header row if first row has text
    first = str(df.iloc[0, 0]).strip().lower()
    if not first.replace('.','').isdigit():
        df = df.iloc[1:].reset_index(drop=True)

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
    df = df[['name', 'attendance', 'marks', 'study_hours', 'assignments_completed', 'result']]

    # convert feature columns to numbers
    for col in FEATURE_COLS:
        df[col] = pd.to_numeric(df[col], errors='coerce')
    df['assignments_completed'] = df['assignments_completed'].fillna(5)

    df = df.dropna(subset=['attendance', 'marks', 'study_hours', 'result'])

    # handle result: pass/fail text or 0/1 numbers
    first_val = str(df['result'].iloc[0]).strip().lower()
    if first_val in ('pass', 'fail'):
        df['result'] = df['result'].astype(str).str.strip().str.lower().map({'pass': 1, 'fail': 0})
    else:
        df['result'] = pd.to_numeric(df['result'], errors='coerce').astype('Int64')

    df = df.dropna(subset=['result'])
    df['result'] = df['result'].astype(int)
    return df


def apply_feature_weights(df):
    # multiply each column by its weight so the model
    # pays more attention to the important features
    weighted = df[FEATURE_COLS].copy()
    for col, w in WEIGHTS.items():
        weighted[col] = weighted[col] * w
    return weighted


def train_models(X_train, y_train):
    rf = RandomForestClassifier(
        n_estimators=100,
        max_depth=8,
        min_samples_leaf=3,
        random_state=42
    )
    rf.fit(X_train, y_train)

    lr = LogisticRegression(max_iter=1000, C=0.5)
    lr.fit(X_train, y_train)

    return rf, lr


def evaluate_model(model, X_test, y_test):
    preds = model.predict(X_test)
    acc = accuracy_score(y_test, preds)
    cm = confusion_matrix(y_test, preds).tolist()
    return acc, cm


def save_model(rf_model):
    os.makedirs('model', exist_ok=True)
    joblib.dump(rf_model, 'model/saved_model.pkl')


def add_noise(df):
    if len(df) < 20:
        return df
    borderline = df[
        (df['marks'].between(45, 65)) |
        (df['attendance'].between(55, 75))
    ]
    if len(borderline) > 0:
        noisy = borderline.sample(frac=0.12, random_state=42).copy()
        noisy['result'] = 1 - noisy['result']
        df = pd.concat([df, noisy], ignore_index=True)
    return df


def run_training(filepath):
    df = load_and_clean_data(filepath)

    # 10k rows is more than enough to get good accuracy
    # using all million rows just slows everything down
    if len(df) > 10000:
        df = df.sample(n=10000, random_state=42).reset_index(drop=True)

    df = add_noise(df)

    X = apply_feature_weights(df)
    y = df['result']

    test_sz = 0.2 if len(df) >= 10 else 0.0
    if test_sz == 0.0:
        X_train, X_test, y_train, y_test = X, X, y, y
    else:
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_sz, random_state=42
        )

    rf, lr = train_models(X_train, y_train)

    rf_acc, rf_cm = evaluate_model(rf, X_test, y_test)
    lr_acc, _ = evaluate_model(lr, X_test, y_test)

    save_model(rf)

    return {
        'rf_accuracy': round(rf_acc * 100, 2),
        'lr_accuracy': round(lr_acc * 100, 2),
        'feature_importances': dict(zip(FEATURE_COLS, rf.feature_importances_.tolist())),
        'lr_coefficients': dict(zip(FEATURE_COLS, lr.coef_[0].tolist())),
        'confusion_matrix': rf_cm
    }
