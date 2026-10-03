// Zod schemas for user input. Owned by Agent A.
import { z } from 'zod'

export const RENT_MIN = 300
export const RENT_MAX = 15_000
/** Above this, the form asks "Is this monthly?" before submitting. */
export const RENT_SOFT_MAX = 6_000

export const propertyFormSchema = z.object({
  address: z.string({ required_error: 'Enter the property address' }).trim().min(3, 'Enter the property address'),
  place_id: z.string().optional(),
  location: z.object({ lng: z.number(), lat: z.number() }).optional(),
  monthly_rent: z
    .number({ required_error: 'Enter the monthly rent', invalid_type_error: 'Enter the monthly rent' })
    .int('Use a whole number of euro')
    .min(RENT_MIN, `Monthly rent must be at least €${RENT_MIN}`)
    .max(RENT_MAX, `Monthly rent must be at most €${RENT_MAX.toLocaleString('en-IE')}`),
  bedrooms: z
    .number({ required_error: 'Choose the number of bedrooms', invalid_type_error: 'Choose the number of bedrooms' })
    .int()
    .min(0)
    .max(5),
  property_type: z.enum(['apartment', 'house', 'duplex', 'shared_room'], {
    required_error: 'Choose the property type',
    invalid_type_error: 'Choose the property type',
  }),
  floor_area_m2: z
    .number({ invalid_type_error: 'Enter a number' })
    .min(15, 'Floor area must be at least 15 m²')
    .max(500, 'Floor area must be at most 500 m²')
    .optional(),
  furnished: z.enum(['furnished', 'unfurnished', 'unknown']).default('unknown'),
  listing_url: z
    .string()
    .trim()
    .url('Enter a full link starting with https://')
    .refine(v => /^https?:\/\//.test(v), 'Enter a full link starting with https://')
    .optional()
    .or(z.literal('').transform(() => undefined)),
})

export type PropertyFormValues = z.infer<typeof propertyFormSchema>
