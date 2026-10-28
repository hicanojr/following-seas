"""JobSpy worker for Fair Winds.

Searches Indeed, ZipRecruiter, Glassdoor, and Google, writes postings to
Supabase, embeds them, and caches one Claude parse of the base resume.

It never applies, never uses Easy Apply, never messages anyone, and never
signs in to LinkedIn.
"""
