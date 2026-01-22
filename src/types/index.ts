export interface Book {
  id: string
  isbn?: string
  title: string
  author: string
  translator?: string
  publisher?: string
  detailUrl?: string
  cover_url?: string
  description?: string
  publish_year?: number
  page_count?: number
  jd_sku?: string
  jd_url?: string
  list_price?: number
  status: 'unpurchased' | 'reading' | 'finished'
  purchase_date?: string
  start_reading_date?: string
  finish_reading_date?: string
  reading_progress: number
  created_at: string
  updated_at: string
}

export interface Series {
  id: string
  name: string
  author?: string
  sort_mode?: 'publish_year' | 'manual'
  created_at: string
}

export interface PriceHistory {
  id: string
  book_id: string
  price: number
  original_price?: number
  discount_rate?: number
  in_stock: boolean
  fetched_at: string
}
