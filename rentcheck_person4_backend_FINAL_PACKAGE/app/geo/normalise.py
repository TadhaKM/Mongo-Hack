import re

WHITESPACE = re.compile(r"\s+")
PUNCT = re.compile(r"[^A-Za-z0-9À-ÖØ-öø-ÿ'/-]+")

def normalise_address(value: str) -> str:
    value = value.strip().upper()
    value = PUNCT.sub(" ", value)
    value = WHITESPACE.sub(" ", value)
    return value.strip()
