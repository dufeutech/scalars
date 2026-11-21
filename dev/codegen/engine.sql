-- The checks, one function per $meta.checks entry, named check_ + the check's name. Each takes the normalized,
-- pattern-matched value and returns false (never an error) on anything outside its alphabet. Characters are read as
-- UTF-8 bytes with get_byte, which is O(1); substr on text walks from the start, so a loop over it would be quadratic.
-- Sums are reduced mod as they go, in integer: no numeric, no growing totals.
CREATE SCHEMA IF NOT EXISTS scalars;

-- GS1 mod 10: from the right, digits weigh 1, 3, 1, 3, ...; the total is a multiple of 10.
CREATE OR REPLACE FUNCTION scalars.check_gs1_mod10(s text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
    b bytea := convert_to(s, 'UTF8');
    n integer := length(b);
    t integer := 0;
    c integer;
BEGIN
    FOR i IN 0 .. n - 1 LOOP
        c := get_byte(b, n - 1 - i) - 48;
        IF c < 0 OR c > 9 THEN RETURN false; END IF;
        t := (t + c * CASE WHEN i % 2 = 1 THEN 3 ELSE 1 END) % 10;
    END LOOP;
    RETURN t = 0;
END $$;

-- ISO 7064 mod 97-10: digits as themselves, letters as 10-35 (two digits); the number mod 97 is 1.
CREATE OR REPLACE FUNCTION scalars.check_iso7064_mod97_10(s text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
    b bytea := convert_to(s, 'UTF8');
    r integer := 0;
    c integer;
BEGIN
    FOR i IN 0 .. length(b) - 1 LOOP
        c := get_byte(b, i);
        IF c BETWEEN 48 AND 57 THEN r := (r * 10 + c - 48) % 97;
        ELSIF c BETWEEN 65 AND 90 THEN r := (r * 100 + c - 55) % 97;
        ELSIF c BETWEEN 97 AND 122 THEN r := (r * 100 + c - 87) % 97;
        ELSE RETURN false;
        END IF;
    END LOOP;
    RETURN r = 1;
END $$;

-- IBAN: the first four characters move to the end, then mod 97-10.
CREATE OR REPLACE FUNCTION scalars.check_iban(s text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT scalars.check_iso7064_mod97_10(substr(s, 5) || left(s, 4))
$$;

-- ISBN: 13 digits are GS1 mod 10; 10 characters weigh 10 down to 1 (X is 10) and total a multiple of 11.
CREATE OR REPLACE FUNCTION scalars.check_isbn(s text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
    b bytea := convert_to(s, 'UTF8');
    t integer := 0;
    c integer;
BEGIN
    IF length(b) = 13 THEN RETURN scalars.check_gs1_mod10(s); END IF;
    IF length(b) <> 10 THEN RETURN false; END IF;
    FOR i IN 0 .. 9 LOOP
        c := get_byte(b, i);
        IF c = 88 OR c = 120 THEN c := 10;
        ELSIF c BETWEEN 48 AND 57 THEN c := c - 48;
        ELSE RETURN false;
        END IF;
        t := (t + c * (10 - i)) % 11;
    END LOOP;
    RETURN t = 0;
END $$;

-- ISO 7064 mod 11-2 (ORCID): hyphens dropped; the last character is the check digit, X for 10.
CREATE OR REPLACE FUNCTION scalars.check_iso7064_mod11_2(s text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
    b bytea := convert_to(replace(s, '-', ''), 'UTF8');
    n integer := length(b);
    t integer := 0;
    c integer;
    r integer;
BEGIN
    IF n = 0 THEN RETURN false; END IF;
    FOR i IN 0 .. n - 2 LOOP
        c := get_byte(b, i) - 48;
        IF c < 0 OR c > 9 THEN RETURN false; END IF;
        t := ((t + c) * 2) % 11;
    END LOOP;
    r := (12 - t) % 11;
    c := get_byte(b, n - 1);
    RETURN c = CASE WHEN r = 10 THEN 88 ELSE 48 + r END;
END $$;

-- Digits as text are at most max: leading zeros dropped, then fewer digits is smaller and equal counts compare
-- bytewise. O(n), and never a number.
CREATE OR REPLACE FUNCTION scalars.digits_at_most(s text, max text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE WHEN char_length(d) <> char_length(max) THEN char_length(d) < char_length(max)
        ELSE d COLLATE "C" <= max COLLATE "C" END
    FROM (SELECT COALESCE(NULLIF(ltrim(s, '0'), ''), left(s, 1)) AS d) z
$$;

-- int64_range: the signed 64-bit range.
CREATE OR REPLACE FUNCTION scalars.check_int64_range(s text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT CASE WHEN left(s, 1) = '-' THEN scalars.digits_at_most(substr(s, 2), '9223372036854775808')
        ELSE scalars.digits_at_most(s, '9223372036854775807') END
$$;

-- uint64_range: the unsigned 64-bit range.
CREATE OR REPLACE FUNCTION scalars.check_uint64_range(s text) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
    SELECT scalars.digits_at_most(s, '18446744073709551615')
$$;
