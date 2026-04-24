import json

def handler(event, context):
    try:
        body = event.get("body")

        if body:
            data = json.loads(body)
        else:
            data = {}

        return {
            "statusCode": 200,
            "headers": {
                "content-type": "application/json"
            },
            "body": json.dumps({
                "message": "Profile received successfully",
                "received_profile": data
            }),
        }

    except json.JSONDecodeError:
        return {
            "statusCode": 400,
            "headers": {
                "content-type": "application/json"
            },
            "body": json.dumps({
                "error": "Invalid JSON body"
            }),
        }