#!/bin/bash

set -ex

rm -rf temp
mkdir temp
pushd temp

curl -L -o 'autoeq.zip' 'https://github.com/jaakkopasanen/AutoEq/archive/master.zip'
curl -L -o 'oratory-pdfs.7z' 'https://www.dropbox.com/scl/fi/2ejg5akb5zigfncd1u1as/PDFs-27.11.24.7z?rlkey=23cksihiq2r14svx520qkwbuk&e=2&dl=1'

unzip autoeq.zip
7z e -o./oratory-pdfs 'oratory-pdfs.7z'

popd

./import_autoeq.ts temp/AutoEq-master/results temp/database-autoeq
./preprocess_oratory.ts temp/oratory-pdfs     temp/database-oratory

./merge.ts temp/database-autoeq  ../database
./merge.ts temp/database-oratory ../database

rm -rf temp
