#!/usr/bin/env python3
"""Auto-dialog bridge: WorkBuddy <-> Gemini.
WorkBuddy writes to gemini-dialog.md, this script calls Gemini API,
appends response, then WorkBuddy reads and replies. Loop continues.

Usage:
  set GEMINI_API_KEY=your_key
  python gemini-bridge.py C:/Users/陆峻/Desktop/gemini-dialog.md --rounds 5
"""
import sys, os, json, time, re

API_KEY = os.environ.get('GEMINI_API_KEY', '')
API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

def call_gemini(prompt: str) -> str:
    resp = __import__('urllib.request').request.urlopen(
        __import__('urllib.request').Request(
            API_URL + '?key=' + API_KEY,
            data=json.dumps({
                'contents': [{'parts': [{'text': prompt}]}],
                'generationConfig': {'temperature': 0.7, 'maxOutputTokens': 4096},
            }).encode(),
            headers={'Content-Type': 'application/json'},
        ),
        timeout=120,
    )
    data = json.loads(resp.read())
    return data['candidates'][0]['content']['parts'][0]['text']

def find_last_gemini(msg: str) -> str:
    """Extract Gemini's last message (everything after last ## Gemini heading)."""
    parts = re.split(r'\n## Gemini\n', msg)
    if len(parts) >= 2:
        return parts[-1].strip()
    return ''

def find_last_workbuddy(msg: str) -> str:
    """Extract WorkBuddy's last message."""
    parts = re.split(r'\n## WorkBuddy\n', msg)
    if len(parts) >= 2:
        return parts[-1].strip()
    return ''

def main(filepath: str, rounds: int = 5):
    if not API_KEY:
        print('ERROR: Set GEMINI_API_KEY environment variable')
        sys.exit(1)

    for i in range(rounds):
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()

        # Find the last speaker
        if content.strip().endswith('（请在此处继续）'):
            # It's Gemini's turn - extract the full context and send to Gemini
            prompt = content + '\n\n请继续对话。直接回复，不要用markdown代码块包裹。'
            print(f'[Round {i+1}] Calling Gemini...')
            try:
                reply = call_gemini(prompt)
                # Append Gemini's response
                new_content = content.replace('（请在此处继续）', '')
                new_content += '\n\n' + reply.strip() + '\n\n---\n\n## WorkBuddy\n\n（请在此处继续）\n'
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f'[Round {i+1}] Gemini replied ({len(reply)} chars)')
            except Exception as e:
                print(f'[Round {i+1}] Gemini API error: {e}')
                break
        elif content.strip().endswith('（请在此处继续）'):
            # It's WorkBuddy's turn - wait for human to trigger WorkBuddy reply
            print(f'[Round {i+1}] Waiting for WorkBuddy...')
            time.sleep(2)  # WorkBuddy needs manual trigger from user
        else:
            print(f'[Round {i+1}] Unknown state, exiting')
            break

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('Usage: python gemini-bridge.py <path-to-dialog.md> [--rounds N]')
        sys.exit(1)
    r = 5
    if '--rounds' in sys.argv:
        r = int(sys.argv[sys.argv.index('--rounds') + 1])
    main(sys.argv[1], r)
