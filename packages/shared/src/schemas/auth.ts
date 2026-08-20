import { z } from 'zod'

/**
 * Single source of truth for login input.
 *
 * The API validates request bodies against this schema, and the web login form
 * validates against the same object via mantine-form-zod-resolver — so client
 * and server can never disagree about what a valid login looks like.
 */
export const loginSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginInput = z.infer<typeof loginSchema>
