#!/bin/bash

set -e

git add .
git commit -m "Sync nodes - $(date '+%Y-%m-%d %H:%M:%S')"
git push origin
