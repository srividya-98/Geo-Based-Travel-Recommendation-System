-- osm2pgsql Flex output style for POI extraction
-- This extracts restaurants, cafes, groceries, attractions, parks, museums
-- into a format optimized for our travel agent app.

-- Define the output table
local poi_table = osm2pgsql.define_table({
    name = 'osm_pois',
    schema = 'public',
    ids = { type = 'any', id_column = 'osm_id', type_column = 'osm_type' },
    columns = {
        { column = 'name', type = 'text' },
        { column = 'category', type = 'text' },
        { column = 'subcategory', type = 'text' },
        { column = 'tags', type = 'jsonb' },
        { column = 'geom', type = 'point', projection = 4326, not_null = true },
    }
})

-- Category mapping functions
local function get_category_and_subcategory(tags)
    local amenity = tags['amenity']
    local shop = tags['shop']
    local tourism = tags['tourism']
    local leisure = tags['leisure']
    
    -- Restaurant category
    if amenity == 'restaurant' then
        return 'restaurant', 'restaurant'
    elseif amenity == 'fast_food' then
        return 'restaurant', 'fast_food'
    
    -- Cafe category
    elseif amenity == 'cafe' then
        return 'cafe', 'cafe'
    elseif amenity == 'bar' then
        return 'cafe', 'bar'
    elseif shop == 'coffee' then
        return 'cafe', 'coffee_shop'
    
    -- Grocery category
    elseif shop == 'supermarket' then
        return 'grocery', 'supermarket'
    elseif shop == 'convenience' then
        return 'grocery', 'convenience'
    elseif shop == 'grocery' then
        return 'grocery', 'grocery'
    elseif shop == 'greengrocer' then
        return 'grocery', 'greengrocer'
    elseif shop == 'bakery' then
        return 'grocery', 'bakery'
    
    -- Scenic category
    elseif tourism == 'attraction' then
        return 'scenic', 'attraction'
    elseif tourism == 'viewpoint' then
        return 'scenic', 'viewpoint'
    elseif leisure == 'park' then
        return 'scenic', 'park'
    elseif leisure == 'garden' then
        return 'scenic', 'garden'
    elseif tourism == 'artwork' then
        return 'scenic', 'artwork'
    
    -- Indoor category
    elseif tourism == 'museum' then
        return 'indoor', 'museum'
    elseif amenity == 'cinema' then
        return 'indoor', 'cinema'
    elseif amenity == 'theatre' then
        return 'indoor', 'theatre'
    elseif tourism == 'gallery' then
        return 'indoor', 'gallery'
    elseif amenity == 'library' then
        return 'indoor', 'library'
    end
    
    return nil, nil
end

-- Extract relevant tags as JSON
local function extract_tags(tags)
    local result = {}
    
    -- Common tags
    local keep_tags = {
        'cuisine', 'opening_hours', 'website', 'phone', 'email',
        'wheelchair', 'outdoor_seating', 'takeaway', 'delivery',
        'diet:vegetarian', 'diet:vegan', 'diet:halal', 'diet:kosher',
        'internet_access', 'wifi', 'smoking', 'air_conditioning',
        'payment:cash', 'payment:credit_cards', 'payment:debit_cards',
        'addr:street', 'addr:housenumber', 'addr:city', 'addr:postcode',
        'brand', 'operator', 'description', 'image', 'wikidata', 'wikipedia',
        'stars', 'fee', 'capacity', 'level'
    }
    
    for _, tag_name in ipairs(keep_tags) do
        if tags[tag_name] then
            result[tag_name] = tags[tag_name]
        end
    end
    
    return result
end

-- Check if object should be included
local function is_poi(tags)
    local category, _ = get_category_and_subcategory(tags)
    return category ~= nil
end

-- Process node
function osm2pgsql.process_node(object)
    if not is_poi(object.tags) then
        return
    end
    
    local name = object.tags['name']
    -- Skip POIs without names (they're less useful)
    if not name or name == '' then
        return
    end
    
    local category, subcategory = get_category_and_subcategory(object.tags)
    local extracted_tags = extract_tags(object.tags)
    
    poi_table:insert({
        name = name,
        category = category,
        subcategory = subcategory,
        tags = extracted_tags,
        geom = object:as_point()
    })
end

-- Process way (for POIs that are areas, use centroid)
function osm2pgsql.process_way(object)
    if not object.is_closed then
        return
    end
    
    if not is_poi(object.tags) then
        return
    end
    
    local name = object.tags['name']
    if not name or name == '' then
        return
    end
    
    local category, subcategory = get_category_and_subcategory(object.tags)
    local extracted_tags = extract_tags(object.tags)
    
    poi_table:insert({
        name = name,
        category = category,
        subcategory = subcategory,
        tags = extracted_tags,
        geom = object:as_polygon():centroid()
    })
end

-- Process relation (for multi-polygon POIs)
function osm2pgsql.process_relation(object)
    if object.tags['type'] ~= 'multipolygon' then
        return
    end
    
    if not is_poi(object.tags) then
        return
    end
    
    local name = object.tags['name']
    if not name or name == '' then
        return
    end
    
    local category, subcategory = get_category_and_subcategory(object.tags)
    local extracted_tags = extract_tags(object.tags)
    
    -- Get centroid of the multipolygon
    local geom = object:as_multipolygon()
    if geom then
        poi_table:insert({
            name = name,
            category = category,
            subcategory = subcategory,
            tags = extracted_tags,
            geom = geom:centroid()
        })
    end
end
