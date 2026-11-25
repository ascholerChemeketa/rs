# ****************************************************
# |docname| - templates for student-facing pages
# ****************************************************
# Student-facing pages (choose/do assignment, the course home page, the
# progress report) render inside the book's own page template when the book
# provides one: a PreTeXt book ships a ``_base.html`` that
# `get_jinja_templates` finds before the shared one.  The
# ``use_pretext_student_pages`` course attribute (default on) opts a course out.
from typing import Any, Tuple

from fastapi.templating import Jinja2Templates

from rsptx.configuration import settings
from rsptx.db.crud import course_attr_is_true
from rsptx.logging import rslogger
from rsptx.response_helpers import safe_join
from rsptx.templates.core import get_jinja_templates, get_shared_templates


def get_student_page_templates(
    course: Any, course_attrs: dict
) -> Tuple[Jinja2Templates, bool]:
    """Return the template environment for a student-facing page.

    :param course: the course row being viewed
    :param course_attrs: the course's attributes
    :return: ``(templates, use_pretext_student_pages)``.  When the second
        value is True the caller must also put ``ebook_config_override`` and
        the book base's variables (``base_url``, ``readings`` ...) in the
        context.
    """
    if not course_attr_is_true(course_attrs, "use_pretext_student_pages", default=True):
        return get_shared_templates(), False

    book_path = safe_join(
        settings.book_path,
        course.base_course,
        "published",
        course.base_course,
    )
    if not book_path:
        rslogger.warning(
            "Unsafe or invalid book_path computed for course %s; falling back to shared templates",
            course.course_name,
        )
        return get_shared_templates(), True
    return get_jinja_templates(book_path), True
