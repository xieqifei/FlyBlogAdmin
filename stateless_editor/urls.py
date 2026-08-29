from django.urls import path

from . import views


urlpatterns = [
    path("", views.article_list, name="home"),
    path("setup/", views.setup_view, name="setup"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("articles/edit/", views.edit_article, name="edit_article"),
    path("articles/save/", views.save_article, name="save_article"),
    path("articles/optimize/", views.optimize_article, name="optimize_article"),
    path("articles/delete/", views.delete_article, name="delete_article"),
    path("assets/stackedit.js", views.stackedit_script, name="stackedit_script"),
    path("robots.txt", views.robots, name="robots"),
]
