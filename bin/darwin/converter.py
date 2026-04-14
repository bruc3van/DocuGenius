#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DocuGenius converter wrapper for Darwin.
Delegates to the shared converter.py in the parent directory.
"""

import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from converter import main

if __name__ == '__main__':
    main()
