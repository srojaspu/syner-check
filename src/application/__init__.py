"""Application public surface."""

from .movsynerpos import MAX_DOCUMENTOS as MOVSYNERPOS_MAX_DOCUMENTOS
from .movsynerpos import send_movsynerpos
from .ports import (
    GraphqlGateway,
    IntelisisReader,
    MovSynerPosWriter,
    SqlDocumentReader,
    SunatCacheStore,
    SunatValidator,
)
from .sunat_submission import SunatSubmissionRegistry, submission_fingerprint
from .use_cases import (
    FLOW_STAGE_INTELISIS,
    FLOW_STAGE_SUNAT,
    SUNAT_REQUEST_MAX,
    SUNAT_SCOPE_NO_ACEPTADOS,
    SUNAT_SCOPE_TODOS,
    SUNAT_SCOPES,
    attach_sunat_status,
    get_detail,
    reconcile_pending_sunat_jobs,
    search_by_number,
    submit_sunat_batch,
    summarize,
    sunat_job_status,
    sunat_revalidate,
)

__all__ = [
    "FLOW_STAGE_INTELISIS",
    "FLOW_STAGE_SUNAT",
    "GraphqlGateway",
    "IntelisisReader",
    "MOVSYNERPOS_MAX_DOCUMENTOS",
    "MovSynerPosWriter",
    "SUNAT_REQUEST_MAX",
    "SUNAT_SCOPE_NO_ACEPTADOS",
    "SUNAT_SCOPE_TODOS",
    "SUNAT_SCOPES",
    "SqlDocumentReader",
    "SunatCacheStore",
    "SunatSubmissionRegistry",
    "SunatValidator",
    "attach_sunat_status",
    "get_detail",
    "reconcile_pending_sunat_jobs",
    "search_by_number",
    "send_movsynerpos",
    "submit_sunat_batch",
    "submission_fingerprint",
    "summarize",
    "sunat_job_status",
    "sunat_revalidate",
]
