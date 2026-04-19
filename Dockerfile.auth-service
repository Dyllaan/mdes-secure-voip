FROM amazoncorretto:21 AS build
WORKDIR /app
COPY . .
RUN sed -i 's/\r$//' gradlew && chmod +x gradlew && ./gradlew bootJar -x test --no-daemon
FROM amazoncorretto:21
WORKDIR /app
COPY --from=build /app/build/libs/AuthService-*-RELEASE.jar app.jar
CMD ["java", "-jar", "app.jar", "--spring.profiles.active=docker"]