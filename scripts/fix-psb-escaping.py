import re, urllib.request

req = urllib.request.Request("http://localhost:3001/p/site-cec6c0")
html = urllib.request.urlopen(req, timeout=10).read().decode("utf-8", errors="replace")

idx = html.find("function renderPolicyStatsBar(data){")
end = html.find("function renderIntelFeed(data){")

if idx > 0 and end > idx:
    func = html[idx:end]
    
    # Fix: The DB HTML has literal \\" which in JS becomes \" (escaped backslash then quote ends string)
    # We need literal \" in the JS string, which in the DB HTML is just \" 
    # Current: class=\\"psb-label\\" (4 raw chars: \ \ " p s b ...)
    # Target:  class=\"psb-label\" (3 raw chars: \ " p s b ...)
    # In Python: replace double-backslash-quote with backslash-quote
    func_fixed = func.replace('\\\\"psb-label\\\\"', '\\"psb-label\\"')
    func_fixed = func_fixed.replace('\\\\"psb-cats\\\\"', '\\"psb-cats\\"')
    func_fixed = func_fixed.replace('\\\\"psb-cat\\\\"', '\\"psb-cat\\"')
    
    if func_fixed != func:
        html = html[:idx] + func_fixed + html[end:]
        print("FIXED: replaced double-backslash-quote with backslash-quote")
    else:
        # Try other patterns
        for m in re.finditer(r'class=.[a-z"-\\\\]+', func):
            print("Found:", repr(m.group()))
        
    with open("/tmp/v34-fixed.html", "w", encoding="utf-8") as f:
        f.write(html)
    print("Saved")
else:
    print("Function not found")
