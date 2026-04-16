IMAGE_REGISTRY ?= quay.io/example

.PHONY: client-run server-run build-client build-server build-all run-all podman-server-build podman-client-build podman-build-all podman-push-all helm-deploy

build-all: build-server build-client

run-all:
	$(MAKE) server-run &
	$(MAKE) client-run

client-run:
	cd client && npx next dev -H 0.0.0.0 -p 3000

server-run:
	cd server && ./server

build-client:
	cd client && NEXT_OUTPUT=standalone npm run build

build-server:
	cd server && go build ./...

podman-build-all: podman-server-build podman-client-build

podman-server-build:
	podman build $(PODMAN_ARGS) -f Containerfile.server -t $(IMAGE_REGISTRY)/booking-app-server:latest .

podman-client-build:
	podman build $(PODMAN_ARGS) -f Containerfile.client -t $(IMAGE_REGISTRY)/booking-app-client:latest .

podman-push-all:
	podman push $(IMAGE_REGISTRY)/booking-app-server:latest
	podman push $(IMAGE_REGISTRY)/booking-app-client:latest

helm-deploy:
	helm upgrade --install booking-app ./chart $(HELM_ARGS)
