use lopdf::Document;
use serde::Serialize;

const MAX_PDF_BYTES: usize = 8 * 1024 * 1024;
const MAX_PDF_PAGE_COUNT: usize = 10_000;
const MAX_EXTRACTED_PAGES: usize = 128;
const MAX_DECOMPRESSED_PAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_PAGE_TEXT_BYTES: usize = 64 * 1024;
const MAX_TOTAL_TEXT_BYTES: usize = 512 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageExtraction {
    page_number: u32,
    text: String,
    truncated: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExtraction {
    page_count: usize,
    pages: Vec<PdfPageExtraction>,
    extracted_text_bytes: usize,
    truncated: bool,
}

fn truncate_utf8(value: &str, max_bytes: usize) -> (&str, bool) {
    if value.len() <= max_bytes {
        return (value, false);
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    (&value[..end], true)
}

fn safe_pdf_error(error: impl std::fmt::Display) -> String {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    if lower.contains("encrypt") || lower.contains("password") {
        "PDF is encrypted and cannot be inspected without a password.".into()
    } else if lower.contains("memory limit") || lower.contains("decompress") {
        "PDF page content exceeds Clack's safe decompression limit.".into()
    } else {
        "PDF content is malformed or uses an unsupported structure.".into()
    }
}

fn extract_pdf(bytes: &[u8]) -> Result<PdfExtraction, String> {
    if bytes.is_empty() || bytes.len() > MAX_PDF_BYTES {
        return Err(format!(
            "PDF input must be between 1 and {MAX_PDF_BYTES} bytes."
        ));
    }
    if !bytes.starts_with(b"%PDF-") {
        return Err("Attachment does not have a PDF signature.".into());
    }
    let document = Document::load_mem(bytes).map_err(safe_pdf_error)?;
    if document.is_encrypted() {
        return Err("Encrypted PDFs are not supported.".into());
    }
    let pages = document.get_pages();
    if pages.is_empty() {
        return Err("PDF does not contain any pages.".into());
    }
    if pages.len() > MAX_PDF_PAGE_COUNT {
        return Err(format!(
            "PDF exceeds Clack's {MAX_PDF_PAGE_COUNT}-page safety limit."
        ));
    }

    let mut extracted = Vec::new();
    let mut extracted_text_bytes = 0;
    let mut truncated = pages.len() > MAX_EXTRACTED_PAGES;
    for page_number in pages.keys().copied().take(MAX_EXTRACTED_PAGES) {
        if extracted_text_bytes >= MAX_TOTAL_TEXT_BYTES {
            truncated = true;
            break;
        }
        match document.extract_text_with_limit(&[page_number], MAX_DECOMPRESSED_PAGE_BYTES) {
            Ok(text) => {
                let remaining = MAX_TOTAL_TEXT_BYTES - extracted_text_bytes;
                let limit = remaining.min(MAX_PAGE_TEXT_BYTES);
                let (bounded, page_truncated) = truncate_utf8(&text, limit);
                extracted_text_bytes += bounded.len();
                truncated |= page_truncated;
                extracted.push(PdfPageExtraction {
                    page_number,
                    text: bounded.to_owned(),
                    truncated: page_truncated,
                    error: None,
                });
            }
            Err(error) => {
                extracted.push(PdfPageExtraction {
                    page_number,
                    text: String::new(),
                    truncated: false,
                    error: Some(safe_pdf_error(error)),
                });
            }
        }
    }
    Ok(PdfExtraction {
        page_count: pages.len(),
        pages: extracted,
        extracted_text_bytes,
        truncated,
    })
}

#[tauri::command]
pub async fn attachment_pdf_extract(
    request: tauri::ipc::Request<'_>,
) -> Result<PdfExtraction, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("attachment_pdf_extract expected a raw byte body.".into());
    };
    if bytes.len() > MAX_PDF_BYTES {
        return Err(format!("PDF exceeds the {MAX_PDF_BYTES}-byte input limit."));
    }
    let owned = bytes.to_vec();
    tauri::async_runtime::spawn_blocking(move || extract_pdf(&owned))
        .await
        .map_err(|error| format!("PDF parser task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn simple_pdf(text: &str) -> Vec<u8> {
        let content = format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET");
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>".to_string(),
            format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_string(),
        ];
        let mut output = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(output.len());
            output.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
        }
        let xref = output.len();
        output.extend_from_slice(format!("xref\n0 {}\n", objects.len() + 1).as_bytes());
        output.extend_from_slice(b"0000000000 65535 f \n");
        for offset in offsets {
            output.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        output.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objects.len() + 1
            )
            .as_bytes(),
        );
        output
    }

    #[test]
    fn extracts_page_count_and_embedded_text() {
        let extracted = extract_pdf(&simple_pdf("Hello PDF")).unwrap();
        assert_eq!(extracted.page_count, 1);
        assert_eq!(extracted.pages.len(), 1);
        assert!(extracted.pages[0].text.contains("Hello PDF"));
        assert!(!extracted.truncated);
    }

    #[test]
    fn malformed_and_non_pdf_inputs_are_rejected() {
        assert!(extract_pdf(b"not a pdf").unwrap_err().contains("signature"));
        assert!(extract_pdf(b"%PDF-malformed").is_err());
    }

    #[test]
    fn extracted_text_is_bounded() {
        let text = "a".repeat(MAX_PAGE_TEXT_BYTES + 1024);
        let extracted = extract_pdf(&simple_pdf(&text)).unwrap();
        assert!(extracted.extracted_text_bytes <= MAX_PAGE_TEXT_BYTES);
        assert!(extracted.pages[0].truncated);
        assert!(extracted.truncated);
    }
}
