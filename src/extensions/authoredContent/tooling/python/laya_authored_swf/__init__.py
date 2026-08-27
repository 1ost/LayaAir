"""Provider-owned SWF/JPEXS inspection and evidence tooling.

Public names intentionally mirror the former application-local module while
callers migrate. Native hierarchy emission remains owned by the TypeScript
authored-content emitter.
"""

from .converter import *  # noqa: F401,F403
from .converter import _skip_swf_matrix, _skip_swf_string, _uncompressed_body
