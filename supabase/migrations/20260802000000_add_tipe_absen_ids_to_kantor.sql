-- Migration: Add tipe_absen_ids to kantor table for per-branch attendance type & shift configuration
ALTER TABLE kantor ADD COLUMN IF NOT EXISTS tipe_absen_ids JSONB DEFAULT '[]'::jsonb;
