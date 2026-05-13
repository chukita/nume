-- NuMe — Fase 4: Supabase Storage para imágenes
-- Ejecutar en Supabase Dashboard → SQL Editor

-- ─── Bucket público "images" ───────────────────────────────────
-- También se puede crear desde el Dashboard: Storage → New bucket
-- name: "images", public: true

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'images',
  'images',
  true,               -- público: la URL es accesible sin auth
  2097152,            -- 2 MB máximo por archivo
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do nothing;

-- ─── Políticas de Storage ──────────────────────────────────────

-- Lectura pública (cualquiera puede ver las imágenes)
create policy "public read images"
  on storage.objects for select
  using (bucket_id = 'images');

-- Upload: solo usuarios autenticados pueden subir a su carpeta (tenant_id/)
-- El backend sube con el service_role, así que esta policy es para acceso directo
-- desde el cliente si en algún momento se necesita.
create policy "owner upload images"
  on storage.objects for insert
  with check (
    bucket_id = 'images'
    and auth.role() in ('authenticated', 'service_role')
  );

-- Borrar: solo service_role (el backend lo maneja)
create policy "service delete images"
  on storage.objects for delete
  using (
    bucket_id = 'images'
    and auth.role() = 'service_role'
  );
