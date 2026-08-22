import type {
  CategoryWithUsage,
  CreateCategoryInput,
  CreateProductInput,
  Product,
  UpdateCategoryInput,
  UpdateProductInput,
} from '@otomate/shared'
import { api } from './api'
import { unwrap } from './unwrap'


export const catalogApi = {
  listCategories: () => unwrap<CategoryWithUsage[]>(api.get('/api/admin/categories')),
  createCategory: (input: CreateCategoryInput) =>
    unwrap<CategoryWithUsage>(api.post('/api/admin/categories', input)),
  updateCategory: (id: string, input: UpdateCategoryInput) =>
    unwrap<CategoryWithUsage>(api.patch(`/api/admin/categories/${id}`, input)),
  deleteCategory: (id: string) =>
    unwrap<{ success: boolean }>(api.delete(`/api/admin/categories/${id}`)),

  listProducts: () => unwrap<Product[]>(api.get('/api/admin/products')),
  createProduct: (input: CreateProductInput) =>
    unwrap<Product>(api.post('/api/admin/products', input)),
  updateProduct: (id: string, input: UpdateProductInput) =>
    unwrap<Product>(api.patch(`/api/admin/products/${id}`, input)),
  deactivateProduct: (id: string) => unwrap<Product>(api.delete(`/api/admin/products/${id}`)),

  uploadImage: (id: string, file: File) => {
    const form = new FormData()
    form.append('image', file)
    // Let the browser set the multipart boundary — never set Content-Type here.
    return unwrap<Product>(api.post(`/api/admin/products/${id}/image`, form))
  },
  removeImage: (id: string) => unwrap<Product>(api.delete(`/api/admin/products/${id}/image`)),
}
