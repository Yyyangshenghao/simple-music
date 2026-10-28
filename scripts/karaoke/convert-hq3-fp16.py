"""
生成「HQ3 省显存」模型：下载 UVR 官方 UVR-MDX-NET-Inst_HQ_3.onnx，转成 fp16（输入输出保持 fp32），
并校验结果与 server/lib/karaoke-store.ts 里登记的 sha256 一致。该文件作为 v2.6.0 Release 的附件发布。

依赖版本固定，换版本可能得到不同字节，需同步更新 karaoke-store.ts 里的 sha256 与 bytes：
  uv run --no-project --python 3.11 --with onnx==1.23.2 --with onnxconverter-common==1.16.0 --with numpy==2.4.6 --with protobuf==7.36.2 \
    python scripts/karaoke/convert-hq3-fp16.py <输出目录>
"""
import hashlib
import sys
import urllib.request
from pathlib import Path

import onnx
from onnxconverter_common import float16

SOURCE_URL = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/UVR-MDX-NET-Inst_HQ_3.onnx'
SOURCE_SHA256 = '317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc'
OUTPUT_NAME = 'UVR-MDX-NET-Inst_HQ_3-fp16.onnx'
OUTPUT_SHA256 = '62d30044a9e0980efe2daeba0e0f2080fcb23bf8a46b98c0ba5183fe9bf80a9e'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else '.').resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    source = out_dir / 'UVR-MDX-NET-Inst_HQ_3.onnx'
    if not source.exists() or sha256(source) != SOURCE_SHA256:
        print(f'下载 {SOURCE_URL}')
        urllib.request.urlretrieve(SOURCE_URL, source)
    if sha256(source) != SOURCE_SHA256:
        sys.exit('官方模型校验失败')
    model = float16.convert_float_to_float16(onnx.load(source), keep_io_types=True)
    target = out_dir / OUTPUT_NAME
    onnx.save(model, target)
    actual = sha256(target)
    print(f'{target}\n大小 {target.stat().st_size} 字节\nsha256 {actual}')
    if actual != OUTPUT_SHA256:
        sys.exit('转换结果与登记的 sha256 不一致：确认依赖版本，或同步更新 karaoke-store.ts')


if __name__ == '__main__':
    main()
