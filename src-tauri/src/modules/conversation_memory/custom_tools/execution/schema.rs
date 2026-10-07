use super::*;

pub(super) fn value_matches(schema: &Value, value: &Value, depth: usize) -> Result<()> {
    if depth > 6 {
        return Err("invalid-arguments".into());
    }
    let matches = match schema["type"].as_str() {
        Some("object") => value.as_object().is_some_and(|object| {
            let Some(properties) = schema["properties"].as_object() else {
                return false;
            };
            object.iter().all(|(key, value)| {
                properties
                    .get(key)
                    .is_some_and(|s| value_matches(s, value, depth + 1).is_ok())
            }) && schema["required"].as_array().is_none_or(|required| {
                required
                    .iter()
                    .all(|key| key.as_str().is_some_and(|key| object.contains_key(key)))
            })
        }),
        Some("array") => value.as_array().is_some_and(|items| {
            items.len() as u64 <= schema["maxItems"].as_u64().unwrap_or(0)
                && items
                    .iter()
                    .all(|value| value_matches(&schema["items"], value, depth + 1).is_ok())
        }),
        Some("string") => value.as_str().is_some_and(|text| {
            text.chars().count() as u64 <= schema["maxLength"].as_u64().unwrap_or(0)
        }),
        Some("boolean") => value.is_boolean(),
        Some("null") => value.is_null(),
        Some(kind @ ("integer" | "number")) => value.as_f64().is_some_and(|number| {
            (kind != "integer" || value.is_i64() || value.is_u64())
                && schema["minimum"].as_f64().is_none_or(|min| number >= min)
                && schema["maximum"].as_f64().is_none_or(|max| number <= max)
        }),
        _ => false,
    };
    if !matches
        || schema["enum"]
            .as_array()
            .is_some_and(|items| !items.contains(value))
    {
        return Err("invalid-arguments".into());
    }
    Ok(())
}

pub(super) fn bounded_json(value: &Value, limit: usize) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec(value).map_err(|_| "invalid-arguments")?;
    if bytes.len() > limit {
        return Err("output-limit".into());
    }
    Ok(bytes)
}

pub(super) fn arguments(definition: &Definition, args: &Value) -> Result<String> {
    let bytes = bounded_json(args, MAX_INPUT).map_err(|_| "invalid-arguments")?;
    value_matches(&definition.input_schema, args, 0)?;
    let object = args.as_object().ok_or("invalid-arguments")?;
    match &definition.binding {
        Binding::Native { operation } if operation == "read_file" => {
            if object.len() != 1
                || !args["path"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 1024)
            {
                return Err("invalid-arguments".into());
            }
        }
        Binding::Http { method, .. } if method == "GET" && object.is_empty() => {}
        Binding::Http { method, .. }
            if method == "POST" && object.len() == 1 && object.contains_key("body") => {}
        Binding::Wasi { .. } => {}
        Binding::Mcp { .. } if mcp::validate_binding(&definition.binding).is_ok() => {}
        _ => return Err("unsupported-operation-or-arguments".into()),
    }
    Ok(digest(&bytes))
}
