// Illustrative listing photos (Agent A). Freely licensed images of Irish homes from Wikimedia Commons,
// stored in /public/listings with credits in credits.json. They are NOT photos of the sample listings,
// so the UI always labels them "Illustrative photo" with the author and licence.
import type { PropertyType } from '~/types/api'

export interface ListingPhoto { src: string; type: 'apartment' | 'house' | 'duplex'; author: string; license: string; source: string }

export const PHOTOS: ListingPhoto[] = [
  { src: '/listings/apartment-1.jpg', type: 'apartment', author: "Eric Jones", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:Modern_apartments_in_Hardwicke_Street_-_geograph.org.uk_-_1898445.jpg" },
  { src: '/listings/apartment-2.jpg', type: 'apartment', author: "Dwmalone", license: "CC BY-SA 4.0", source: "https://commons.wikimedia.org/wiki/File:Dublin_-_Pearse_House_-_20220915113616.jpeg" },
  { src: '/listings/apartment-3.jpg', type: 'apartment', author: "Ridiculopathy", license: "CC0", source: "https://commons.wikimedia.org/wiki/File:Jan2026._Mary_Aikenhead_House,_Dublin,_Ireland_01.jpg" },
  { src: '/listings/house-1.jpg', type: 'house', author: "William Murphy", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:Victorian_terraced_houses_in_Shandon_Crescen.jpg" },
  { src: '/listings/house-2.jpg', type: 'house', author: "Brian Flanagan", license: "CC BY-SA 3.0", source: "https://commons.wikimedia.org/wiki/File:The_Coombe,_Dublin.jpg" },
  { src: '/listings/house-3.jpg', type: 'house', author: "William Murphy", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:Upper_Mayor_Street._Located_in_Dublin_Docklands_between_Spencer_Dock_and_the_Point_Depot_(3412221485).jpg" },
  { src: '/listings/duplex-1.jpg', type: 'duplex', author: "Margaret Clough", license: "CC BY-SA 2.0", source: "https://commons.wikimedia.org/wiki/File:Georgian_houses_in_Fitzwilliam_Square_-_geograph.org.uk_-_228783.jpg" },
]

// Shared rooms draw from houses and Georgian buildings (most shared lets in Ireland are in houses).
const POOLS: Record<PropertyType, ListingPhoto['type'][]> = {
  apartment: ['apartment'], house: ['house'], duplex: ['duplex', 'house'], shared_room: ['house', 'duplex'],
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** A stable photo for a listing: same id, same photo, chosen from its property type's pool. */
export function photoFor(id: string, type: PropertyType): ListingPhoto {
  const pool = PHOTOS.filter(p => POOLS[type].includes(p.type))
  return pool[hash(id) % pool.length]!
}
