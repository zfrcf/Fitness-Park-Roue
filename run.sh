#!/bin/bash
# Username Checker - Linux Launcher Script
# Version: UCv1.4.0-stable

echo "=========================================="
echo "  Username Checker - Linux Launcher"
echo "=========================================="
echo ""

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed."
    echo "Please install it with: sudo apt-get install python3 python3-pip"
    exit 1
fi

# Check if pip is available
if ! command -v pip3 &> /dev/null; then
    echo "Error: pip3 is not installed."
    echo "Please install it with: sudo apt-get install python3-pip"
    exit 1
fi

# Check for required system dependencies
echo "Checking system dependencies..."

# Check for tkinter (usually comes with python3-tk)
python3 -c "import tkinter" 2>/dev/null || {
    echo "Warning: tkinter not found. The visual border overlay may not work."
    echo "Install with: sudo apt-get install python3-tk"
}

# Check for X11 libraries (needed for pyautogui on Linux)
if ! dpkg -l | grep -q "libx11-dev\|libxtst-dev\|libxinerama-dev"; then
    echo "Warning: X11 development libraries may be missing."
    echo "Install with: sudo apt-get install libx11-dev libxtst-dev libxinerama-dev"
fi

# Check for udev (needed for keyboard library global hooks)
if [ ! -e /dev/uinput ]; then
    echo "Note: /dev/uinput not found. Global keyboard hooks (ESC key) may require root."
    echo "You can run with sudo, or add your user to the input group:"
    echo "  sudo usermod -a -G input \$USER"
    echo "  (then log out and back in)"
fi

echo ""
echo "Installing/updating Python dependencies..."
pip3 install -r requirements.txt

echo ""
echo "=========================================="
echo "  Starting Username Checker..."
echo "=========================================="
echo ""

# Run the main script
python3 random_word_typer.py

# Keep terminal open on error
if [ $? -ne 0 ]; then
    echo ""
    echo "Script exited with an error. Press Enter to close..."
    read
fi
