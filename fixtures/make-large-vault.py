"""Generate a large synthetic vault ZIP for performance testing. Usage: python3 make-large-vault.py N out.zip"""
import random, sys, zipfile
n = int(sys.argv[1]); out = sys.argv[2]; random.seed(n)
folders = ["Projects", "Areas/Health", "Areas/Home", "Journal", "Ideas", "Reading", "Work/Clients", "Work/Meetings"]
words = "river stone garden lamp quiet signal orbit maple ember harbor cedar velvet prism tide meadow".split()
tags = ["status/active", "status/done", "topic/" + "x", "health", "reading", "idea", "work", "home", "journal"] + [f"topic/t{i}" for i in range(40)]
names = [f"{random.choice(words).title()} {random.choice(words)} {i}" for i in range(n)]
paths = [f"Large Vault/{random.choice(folders)}/{nm}.md" for nm in names]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for i, p in enumerate(paths):
        links = random.sample(range(n), k=min(n, random.randint(0, 6)))
        body = [f"---\ntags: [{', '.join(random.sample(tags, 2))}]\n---", f"# {names[i]}", ""]
        for _ in range(random.randint(3, 12)):
            body.append(" ".join(random.choices(words, k=random.randint(8, 30))) + ".")
        body.append(" ".join(f"[[{names[j]}]]" for j in links) + f" #{random.choice(tags)}")
        if random.random() < 0.05: body.append("[[Does not exist %d]]" % i)
        z.writestr(p, "\n".join(body) + "\n")
print(out, n)
