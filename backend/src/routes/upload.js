import { Hono } from 'hono';
import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { requireAuth, getServiceClient } from '../middleware/auth.js';

const upload = new Hono();

upload.use('*', requireAuth);

// Tamaños máximos por tipo de imagen
const SIZES = {
  item:     { width: 800, height: 600 },
  category: { width: 640, height: 640 },
  logo:     { width: 400, height: 400 },
};

// POST /api/upload/:type   (type: item | category | logo)
// Content-Type: multipart/form-data
// Field: "file" (imagen)
upload.post('/:type', async (c) => {
  const type = c.req.param('type');
  if (!SIZES[type]) return c.json({ error: 'Tipo inválido. Usar: item, category, logo' }, 400);

  const tenantId = c.get('tenantId');

  // Parsear el multipart
  let file;
  try {
    const form = await c.req.formData();
    file = form.get('file');
  } catch {
    return c.json({ error: 'No se pudo parsear el form. Enviar multipart/form-data con campo "file".' }, 400);
  }

  if (!file || typeof file === 'string') {
    return c.json({ error: 'Campo "file" requerido' }, 400);
  }

  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ALLOWED.includes(file.type)) {
    return c.json({ error: `Formato no soportado: ${file.type}. Usar JPG, PNG o WebP.` }, 415);
  }

  // Leer el buffer
  const arrayBuf = await file.arrayBuffer();
  const inputBuf = Buffer.from(arrayBuf);

  // Resize + convertir a webp con sharp
  const { width, height } = SIZES[type];
  let outputBuf;
  try {
    outputBuf = await sharp(inputBuf)
      .resize(width, height, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (e) {
    console.error('sharp error:', e);
    return c.json({ error: 'No se pudo procesar la imagen' }, 422);
  }

  // Subir a Supabase Storage con service_role (bypasea RLS de storage)
  const svc = getServiceClient();
  const path = `${tenantId}/${type}s/${randomUUID()}.webp`;

  const { error: storageErr } = await svc.storage
    .from('images')
    .upload(path, outputBuf, {
      contentType: 'image/webp',
      upsert: false,
    });

  if (storageErr) {
    console.error('storage upload error:', storageErr);
    return c.json({ error: 'Error al subir la imagen' }, 500);
  }

  // Obtener URL pública
  const { data: { publicUrl } } = svc.storage.from('images').getPublicUrl(path);

  return c.json({ url: publicUrl, path }, 201);
});

// DELETE /api/upload  — eliminar una imagen por path
// Body: { path: "tenant_id/items/uuid.webp" }
upload.delete('/', async (c) => {
  const { path } = await c.req.json();
  if (!path) return c.json({ error: 'Campo "path" requerido' }, 400);

  // Validar que el path pertenece al tenant del usuario
  const tenantId = c.get('tenantId');
  if (!path.startsWith(tenantId + '/')) {
    return c.json({ error: 'No autorizado' }, 403);
  }

  const svc = getServiceClient();
  const { error } = await svc.storage.from('images').remove([path]);
  if (error) return c.json({ error: error.message }, 500);

  return c.body(null, 204);
});

export { upload };
