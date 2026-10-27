SHELL := /bin/bash

.PHONY: init build deploy destroy test lint

init:
	npm install
	python -m pip install --upgrade pip
	pip install -r layers/python311/requirements.txt

build:
	npm run build

lint:
	npm run lint

deploy:
	npm run build
	cdk synth
	cdk deploy --all

destroy:
	cdk destroy --all

test:
	cd app/tests && pytest
