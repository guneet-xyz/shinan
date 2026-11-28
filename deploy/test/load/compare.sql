-- Each Trial document's latest stored text, by SHA-256, with its ID: what
-- the move's first commit must hold byte for byte.
select encode(sha256(convert_to(rd.text, 'UTF8')), 'hex') || ' ' || substring(rd.text from '(?n)^id: (.+)$')
from catalog_revision_documents rd
join workspaces w on w.id = rd.workspace_id and w.name = 'Trial'
where rd.revision = (select max(r2.revision) from catalog_revision_documents r2 where r2.document_id = rd.document_id)
order by substring(rd.text from '(?n)^id: (.+)$');
