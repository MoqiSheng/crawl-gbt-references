# Quality Control

## Direct Export Versus Verified Correction

Keep two provenance labels in notes or the working manifest:

- `Scholar direct export` or `CNKI direct export`: copied from the visible GB/T row.
- `Verified correction`: a platform export was incomplete or matched the wrong edition, then corrected using a publisher, DOI registration page, library catalog, or official government source.

Do not describe a corrected record as a direct platform export.

## Match Checks

Check all of the following before accepting an entry:

1. Normalized title is the same work, not a review, translation, commentary, later edition, or similarly titled chapter.
2. First author and publication year agree with the requested record.
3. Document type is correct: journal `[J]`, book `[M]`, chapter `[M]//`, conference `[C]//`, newspaper `[N]`, policy/standard `[Z]`, or online material `[EB/OL]`.
4. Journal, volume, issue, page range or article number are present where applicable.
5. Books and chapters have the correct edition, editors, publisher, place, and page range.

## Known Platform Limitations

- Scholar may select a book review or a later reprint when the title is identical.
- Scholar sometimes exports only the first page of an older APA-indexed article.
- Online-first articles may later receive a different formal issue year and page range. Prefer the formal version of record once assigned, and align the manuscript's in-text year.
- CNKI page structure changes can produce `no_cite_button`; inspect the open page instead of lowering title confidence immediately.
- CNKI login or institutional access may be required even when search results are visible.

## Policy Files

Verify policy documents against the issuing body. Capture issuing organization, exact title, document number when present, publication date, document type, and publication carrier. Do not infer missing metadata.

## Final Audit

- Remove duplicate works across chapters.
- Remove numeric labels if the manuscript uses author-year citations.
- Use `等` for Chinese in-text citations and `et al.` for English in-text citations.
- Keep DOI/URL only when the institution requires them.
- Confirm every in-text citation has one bibliography entry and every bibliography entry is cited.
