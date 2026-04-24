import json

def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"message": "Profile service API is running"}),
    }