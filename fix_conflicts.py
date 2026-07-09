import re

with open("script.js", "r") as f:
    content = f.read()

# Fix conflict 1
content = re.sub(
    r"<<<<<<< HEAD\n    const swings = findSwings\(data, 2\);\n=======\n    const swings = findSwings\(data, 2\); \n>>>>>>> .*?\n",
    r"    const swings = findSwings(data, 2);\n",
    content
)

# Fix conflict 2
content = re.sub(
    r"<<<<<<< HEAD\n}\n=======\n}\n>>>>>>> .*?\n",
    r"}\n",
    content
)

with open("script.js", "w") as f:
    f.write(content)
