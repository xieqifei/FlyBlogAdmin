from django.urls import include, path


urlpatterns = [path("", include("stateless_editor.urls"))]
