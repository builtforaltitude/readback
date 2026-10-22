# Readback

Free ATC radio practice for student pilots. Created by @builtforaltitude.

- `index.html` is the whole trainer.
- `netlify/functions/tts.mjs` makes the realistic voices with Google Cloud Text-to-Speech.

## Settings in Netlify (Project configuration → Environment variables)

- `GOOGLE_TTS_KEY`: your Google Cloud API key, or
- `GOOGLE_SERVICE_ACCOUNT`: the full contents of a service account JSON key file (use one or the other)
- `DAILY_CHAR_CAP`: most characters of new speech per day (optional, default 100000)

Without the key, the trainer still works using each visitor's device voices.
