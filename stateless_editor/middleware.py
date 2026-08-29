class NoStoreMiddleware:
    """Prevent authenticated editor pages and Markdown drafts from being cached."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response["Cache-Control"] = "no-store, max-age=0"
        response["Pragma"] = "no-cache"
        return response
