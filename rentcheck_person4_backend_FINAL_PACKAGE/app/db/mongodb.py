from pymongo import MongoClient
from pymongo.collection import Collection
from app.config import get_settings

_client = None
_db = None

def get_db():
    global _client, _db
    if _db is None:
        settings = get_settings()
        _client = MongoClient(settings.mongodb_uri, serverSelectionTimeoutMS=5000)
        _db = _client[settings.mongodb_database]
    return _db

def collection(name: str) -> Collection:
    return get_db()[name]
