-- Private, lossless document storage for the existing domain model.
-- The Worker verifies Firebase tokens and live group permissions before using this schema.
-- Neither the schema nor the data is exposed through Supabase's browser Data API.
create schema if not exists app_data;
revoke all on schema app_data from public;

create table if not exists app_data.documents (
    path text primary key,
    collection text generated always as (regexp_replace(path, '/[^/]+$', '')) stored,
    data jsonb not null,
    constraint document_path check (
        path ~ '^[^/]+(/[^/]+)*$'
        and cardinality(string_to_array(path, '/')) % 2 = 0
    ),
    constraint document_object check (jsonb_typeof(data) = 'object')
);
create index if not exists documents_collection_idx on app_data.documents (collection, path);
alter table app_data.documents enable row level security;
revoke all on app_data.documents from public;

-- anon/authenticated/service_role receive no grants or policies here. Database access is
-- restricted to the backend connection's owner; Firebase UIDs remain text, not auth.users UUIDs.
