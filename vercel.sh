#!/bin/bash

set -e

# Vercel's Python 3.12 build image uses an externally managed environment.
python3 -m pip install --break-system-packages -r requirements.txt

# Apply database migrations during the deployment build.
python3 manage.py makemigrations --check --dry-run
python3 manage.py migrate --noinput
