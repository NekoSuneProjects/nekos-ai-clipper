# python/bpm_detector.py
import sys
import json
import librosa

def detect_bpm(path):
    y, sr = librosa.load(path)
    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    return int(tempo)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("0")
        sys.exit(0)
    bpm = detect_bpm(sys.argv[1])
    print(bpm)
